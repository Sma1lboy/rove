package run.rove.mobile.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import run.rove.mobile.data.*
import run.rove.mobile.domain.*

class AppModel(application: Application) : AndroidViewModel(application) {
    val bridge = BridgeClient(viewModelScope)
    val repository = RoveRepository(bridge)
    private val credentials = CredentialStore(application)
    private val notifier = Notifier(application)
    val tasks = MutableStateFlow(Tasks())
    val engines = MutableStateFlow<List<Engine>>(emptyList())
    val repos = MutableStateFlow<List<String>>(emptyList())
    val error = MutableStateFlow<String?>(null)
    val demo = MutableStateFlow(false)
    val paired = MutableStateFlow(false)
    private var previous: List<TaskRow>? = null

    init {
        viewModelScope.launch {
            bridge.events.collect { event ->
                if (event.name == "request.error") error.value = "Terminal request refused. Reopen the tab before typing again."
                runCatching { repository.tasksPush(event)?.let(::snapshot) }
                    .onFailure { error.value = "Could not read the task update" }
            }
        }
        viewModelScope.launch {
            bridge.state.collectLatest { state ->
                if (state is Connection.Connected) {
                    previous = null
                    try {
                        snapshot(repository.subscribeTasks())
                        engines.value = repository.engines()
                        repos.value = repository.repos()
                    } catch (e: CancellationException) { throw e }
                    catch (_: Exception) { error.value = "Could not load the bridge. Reconnect to retry." }
                } else previous = null
            }
        }
        try {
            credentials.load()?.let { paired.value = true; bridge.connect(it) }
        } catch (_: Exception) { error.value = "Saved pairing cannot be opened. Pair again." }
    }

    private fun snapshot(value: Tasks) {
        if (!demo.value) transitionNotices(previous, value.tasks).forEach(notifier::post)
        previous = value.tasks
        tasks.value = value.copy(tasks = TaskOrdering.sorted(value.tasks))
    }
    fun pair(url: String, clientId: String, clientSecret: String) {
        try {
            val pairing = Pairing.parse(url, clientId, clientSecret)
            pairing.request()
            credentials.save(pairing)
            demo.value = false; paired.value = true; error.value = null
            bridge.connect(pairing)
        } catch (_: Exception) {
            error.value = "Check the pairing URL and Access credentials. Cloudflare requires wss:// and both headers."
        }
    }
    fun startDemo() {
        try {
            val fixture = DemoFixture(getApplication<Application>().assets.open("demo-fixture.json").bufferedReader().use { it.readText() })
            demo.value = true; paired.value = true; error.value = null
            bridge.connectDemo(fixture)
        } catch (_: Exception) { error.value = "Demo fixture is unavailable" }
    }
    fun unpair() {
        bridge.disconnect()
        if (!demo.value) runCatching { credentials.clear() }.onFailure { error.value = "Could not clear saved pairing" }
        paired.value = false; demo.value = false; previous = null
        tasks.value = Tasks(); engines.value = emptyList(); repos.value = emptyList()
    }
    fun refresh() = action { snapshot(repository.listTasks()) }
    fun action(block: suspend () -> Unit): Job = viewModelScope.launch {
        try { block() }
        catch (e: CancellationException) { throw e }
        catch (e: BridgeFailure) { error.value = "${e.code}: ${e.message}" }
        catch (_: Exception) { error.value = "Request failed. Check the result before retrying." }
    }
    override fun onCleared() { bridge.disconnect() }
}
