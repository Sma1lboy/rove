// The iPhone app's demo (`demo.html`): the client, on canned answers. The transport goes in before the client loads.
import { demoTransport } from "./transport.ts"

Reflect.set(globalThis, "__roveRelay", demoTransport)
void import("../main.tsx")
