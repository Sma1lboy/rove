package run.rove.mobile.data

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import run.rove.mobile.MainActivity
import run.rove.mobile.R
import run.rove.mobile.domain.TaskNotice

class Notifier(private val context: Context) {
    private val manager = context.getSystemService(NotificationManager::class.java)
    init { manager.createNotificationChannel(NotificationChannel("tasks", "Task updates", NotificationManager.IMPORTANCE_DEFAULT)) }
    fun post(notice: TaskNotice) {
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val open = PendingIntent.getActivity(context, notice.taskId.hashCode(),
            Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        manager.notify(notice.taskId.hashCode(), NotificationCompat.Builder(context, "tasks")
            .setSmallIcon(R.drawable.ic_notification).setContentTitle("Rove")
            .setContentText(notice.body).setContentIntent(open).setAutoCancel(true).build())
    }
}
