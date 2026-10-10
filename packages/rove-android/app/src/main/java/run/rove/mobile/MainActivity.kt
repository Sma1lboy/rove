package run.rove.mobile

import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.*
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import run.rove.mobile.ui.*

class MainActivity : ComponentActivity() {
    private val model: AppModel by viewModels()
    private var pairingUrl by mutableStateOf("")
    private val scanner = registerForActivityResult(ScanContract()) { result ->
        result.contents?.let { pairingUrl = it }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // Release builds hide terminal contents from screenshots and recents; debug builds stay capturable for allen's screenshot crawl.
        if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) == 0) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        pairingUrl = intent?.dataString.orEmpty()
        setContent {
            RoveTheme {
                RoveApp(model, pairingUrl, { pairingUrl = it }, {
                    scanner.launch(ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                        .setPrompt("Scan the bridge pairing code").setBeepEnabled(false))
                })
            }
        }
    }
}
