// window-ids <pid>...   Prints "<window id> <x> <y> <width> <height>" for each normal on-screen
//                       window of the given pids.
// window-ids --screen   Prints "<width> <height>" of the main display.
// window-ids --title <window id>   Prints the window's title (needs the screen capture grant).
// CGWindowListCopyWindowInfo gives the owner pid, number and bounds without any accessibility API.
import CoreGraphics
import Foundation

if CommandLine.arguments.dropFirst().first == "--screen" {
  let bounds = CGDisplayBounds(CGMainDisplayID())
  print(Int(bounds.width), Int(bounds.height))
  exit(0)
}
if CommandLine.arguments.dropFirst().first == "--title", CommandLine.arguments.count > 2,
  let id = UInt32(CommandLine.arguments[2])
{
  let info = (CGWindowListCopyWindowInfo([.optionIncludingWindow], id) as? [[String: Any]]) ?? []
  print(info.first?[kCGWindowName as String] as? String ?? "(no title)")
  exit(0)
}
let pids = Set(CommandLine.arguments.dropFirst().compactMap { Int32($0) })
let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
let windows = (CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]]) ?? []
for window in windows {
  guard let pid = window[kCGWindowOwnerPID as String] as? Int32, pids.contains(pid),
    let layer = window[kCGWindowLayer as String] as? Int, layer == 0,
    let number = window[kCGWindowNumber as String] as? Int,
    let bounds = window[kCGWindowBounds as String] as? [String: Double],
    let width = bounds["Width"], let height = bounds["Height"], width > 200, height > 200
  else { continue }
  print(number, Int(bounds["X"] ?? 0), Int(bounds["Y"] ?? 0), Int(width), Int(height))
}
