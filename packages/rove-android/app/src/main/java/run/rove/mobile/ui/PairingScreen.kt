package run.rove.mobile.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.tooling.preview.Preview
import run.rove.mobile.R

@Composable fun PairingScreen(url: String, onUrl: (String) -> Unit, scan: () -> Unit,
                             connect: (String, String, String) -> Unit, demo: () -> Unit) {
    var clientId by remember { mutableStateOf("") }
    var secret by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Image(painterResource(R.drawable.rove_chip), "Rove chip", Modifier.size(80.dp))
        Text("[ rove ]", style = MaterialTheme.typography.headlineLarge)
        Text("your sessions, within reach", style = MaterialTheme.typography.titleMedium)
        Text("Start rove-bridge on your Mac, then paste its pairing URL or scan the code.")
        OutlinedTextField(url, onUrl, label = { Text("pairing URL") }, modifier = Modifier.fillMaxWidth(),
            visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), singleLine = true)
        OutlinedButton(shape = MaterialTheme.shapes.small, onClick = scan) { Text("scan QR code") }
        Text("DIRECT / CLOUDFLARE", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
        Text("The URL selects the network. For preset=cf, enter both Access headers. Direct uses your local network or Tailscale.", style = MaterialTheme.typography.bodySmall)
        OutlinedTextField(clientId, { clientId = it }, label = { Text("CF-Access-Client-Id") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(secret, { secret = it }, label = { Text("CF-Access-Client-Secret") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
        Button(shape = MaterialTheme.shapes.small, onClick = { connect(url, clientId, secret) }, enabled = url.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text("connect") }
        TextButton(onClick = demo, modifier = Modifier.fillMaxWidth()) { Text("try a demo") }
    }
}
@Preview(showBackground = true, widthDp = 390, heightDp = 844)
@Composable fun PairingPreview() { RoveTheme { PairingScreen("", {}, {}, { _, _, _ -> }, {}) } }
