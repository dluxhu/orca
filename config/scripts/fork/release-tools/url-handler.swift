// url-handler get <scheme>            Prints the bundle id of the default handler, or "(none)".
// url-handler set <scheme> <bundle id>  Sets it back. No accessibility API.
import CoreServices
import Foundation

let args = CommandLine.arguments
guard args.count >= 3 else { exit(64) }
let scheme = args[2] as CFString
if args[1] == "get" {
  print((LSCopyDefaultHandlerForURLScheme(scheme)?.takeRetainedValue() as String?) ?? "(none)")
} else if args[1] == "set", args.count == 4 {
  exit(LSSetDefaultHandlerForURLScheme(scheme, args[3] as CFString) == noErr ? 0 : 1)
} else {
  exit(64)
}
