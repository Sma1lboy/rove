package run.rove.mobile.domain

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Owned by the About screen; all operations run on its main dispatcher. */
class UpdateSettingsState {
    private val mutablePrefs = MutableStateFlow<UpdatePrefs?>(null)
    val prefs = mutablePrefs.asStateFlow()
    private val mutableCheck = MutableStateFlow<SettingsLoad<UpdateCheck>?>(null)
    val check = mutableCheck.asStateFlow()
    private val channelSaves = Mutex()
    private val notifySaves = Mutex()
    private var generation = 0L

    fun loadPrefs(value: UpdatePrefs?) { mutablePrefs.value = value }

    private fun selectChannel(channel: String) {
        mutablePrefs.value = mutablePrefs.value?.copy(updateChannel = channel)
        generation++
        mutableCheck.value = null
    }

    suspend fun saveChannel(channel: String, save: suspend (String) -> Unit) = channelSaves.withLock {
        val previous = mutablePrefs.value?.updateChannel ?: return@withLock
        selectChannel(channel)
        try { save(channel) }
        catch (e: Exception) { selectChannel(previous); throw e }
    }

    suspend fun saveNotify(notify: Boolean, save: suspend (Boolean) -> Unit) = notifySaves.withLock {
        val previous = mutablePrefs.value?.updateNotify ?: return@withLock
        mutablePrefs.value = mutablePrefs.value?.copy(updateNotify = notify)
        try { save(notify) }
        catch (e: Exception) {
            mutablePrefs.value = mutablePrefs.value?.copy(updateNotify = previous)
            throw e
        }
    }

    suspend fun checkForUpdate(request: suspend (String?) -> SettingsLoad<UpdateCheck>) {
        if (mutableCheck.value == SettingsLoad.Loading) return
        val channel = mutablePrefs.value?.updateChannel
        val requested = ++generation
        mutableCheck.value = SettingsLoad.Loading
        val result = request(channel)
        if (requested == generation) mutableCheck.value = result
    }
}
