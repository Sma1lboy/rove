package run.rove.mobile

import android.Manifest
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.*
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import run.rove.mobile.ui.*

class MainActivity : ComponentActivity() {
    private val model: AppModel by viewModels()
    private var pairingUrl by mutableStateOf("")
    private val notifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }
    private val scanner = registerForActivityResult(ScanContract()) { result ->
        result.contents?.let { pairingUrl = it }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        pairingUrl = intent?.dataString.orEmpty()
        setContent {
            RoveTheme {
                RoveApp(model, pairingUrl, { pairingUrl = it }, {
                    scanner.launch(ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                        .setPrompt("Scan the bridge pairing code").setBeepEnabled(false))
                }, {
                    if (Build.VERSION.SDK_INT >= 33) notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
                })
            }
        }
    }
}
