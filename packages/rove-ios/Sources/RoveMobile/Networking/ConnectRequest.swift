import Foundation

enum ConnectRequest {
    /// Shown on HTTP 401; deliberately contains no secrets.
    static let unauthorizedMessage = "Rejected by the bridge or Cloudflare Access (401). Check the token and the Access service token."
    /// Header names the app owns; custom headers can't set these.
    static let reservedHeaders: Set<String> = ["authorization"]
}

/// Builds the WebSocket upgrade request. The token goes only in `Authorization: Bearer`; the URL never
/// carries `token` or `preset`. Order: custom headers, then Cloudflare Access, then Authorization (wins).
func makeConnectRequest(_ pairing: Pairing) -> URLRequest {
    var url = pairing.endpoint
    if var comps = URLComponents(url: url, resolvingAgainstBaseURL: false), comps.queryItems != nil {
        let rest = comps.queryItems!.filter { $0.name != "token" && $0.name != "preset" }
        comps.queryItems = rest.isEmpty ? nil : rest
        url = comps.url ?? url
    }
    var req = URLRequest(url: url)
    for (rawName, value) in pairing.customHeaders.sorted(by: { $0.key < $1.key }) {
        let name = rawName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty, !ConnectRequest.reservedHeaders.contains(name.lowercased()) else { continue }
        req.setValue(value, forHTTPHeaderField: name)
    }
    if pairing.preset == .cloudflare {
        req.setValue(pairing.cfAccessClientId.trimmingCharacters(in: .whitespaces), forHTTPHeaderField: "CF-Access-Client-Id")
        req.setValue(pairing.cfAccessClientSecret.trimmingCharacters(in: .whitespaces), forHTTPHeaderField: "CF-Access-Client-Secret")
    }
    req.setValue("Bearer \(pairing.token)", forHTTPHeaderField: "Authorization")
    return req
}
