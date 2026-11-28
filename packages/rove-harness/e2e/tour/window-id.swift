// Prints the CGWindowID of the largest on-screen window owned by a pid (what `screencapture -l` takes).
import CoreGraphics
import Foundation

let pid = Int(CommandLine.arguments[1]) ?? 0
let windows = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
let best = windows
  .filter { ($0[kCGWindowOwnerPID as String] as? Int) == pid && ($0[kCGWindowLayer as String] as? Int) == 0 }
  .filter { ($0[kCGWindowIsOnscreen as String] as? Bool) == true }
  .max { a, b in
    let area = { (w: [String: Any]) -> Double in
      let r = w[kCGWindowBounds as String] as? [String: Double] ?? [:]
      return (r["Width"] ?? 0) * (r["Height"] ?? 0)
    }
    return area(a) < area(b)
  }
if let id = best?[kCGWindowNumber as String] as? Int { print(id) }
