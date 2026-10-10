package run.rove.mobile.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import run.rove.mobile.R
import run.rove.mobile.data.NotificationPrefs
import run.rove.mobile.domain.NotificationAccess

private fun accessOf(context: Context) = NotificationAccess.of(
    NotificationManagerCompat.from(context).areNotificationsEnabled(), NotificationPrefs.asked(context), Build.VERSION.SDK_INT >= 33)

/** The in-app banner switch plus the Android permission it depends on. */
@Composable fun NotificationsSettings(back: () -> Unit) {
    val context = LocalContext.current
    var enabled by remember { mutableStateOf(NotificationPrefs.enabled(context)) }
    var access by remember { mutableStateOf(accessOf(context)) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { access = accessOf(context) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        NotificationPrefs.markAsked(context)
        access = accessOf(context)
    }
    val on = stringResource(R.string.settings_on)
    val off = stringResource(R.string.settings_off)
    SettingsPage(stringResource(R.string.settings_notifications), back) {
        FormSection(stringResource(R.string.settings_banners)) {
            ChoiceTiles(listOf(true, false), enabled, { if (it) on else off }) {
                enabled = it
                NotificationPrefs.setEnabled(context, it)
            }
            Hint(stringResource(R.string.settings_banners_hint))
        }
        when (access) {
            NotificationAccess.Denied -> PermissionTile(stringResource(R.string.settings_permission_denied),
                stringResource(R.string.settings_open_settings)) {
                context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            NotificationAccess.Prompt -> PermissionTile(stringResource(R.string.settings_permission_prompt),
                stringResource(R.string.settings_allow)) { ask.launch(Manifest.permission.POST_NOTIFICATIONS) }
            NotificationAccess.Granted -> Unit
        }
    }
}

@Composable private fun PermissionTile(text: String, action: String, perform: () -> Unit) {
    Column(Modifier.fillMaxWidth().tile(Rove.c.warning.copy(alpha = 0.10f), border = Rove.c.warning).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(text, color = Rove.c.warning, style = Rove.mono(13, FontWeight.Bold))
        TileLabel(action, onClick = perform)
    }
}
