# Cancip Plugin Compatibility

This is the stable integration contract for Obsidian plugins and development agents. Prefer public APIs and Obsidian commands. UI simulation is a verified fallback, not a private-DOM dependency.

## Runtime registration

Register after both plugins are loaded:

```ts
const cancip = app.plugins.plugins.cancip?.api?.v1;
const handle = cancip?.registerPluginAdapter({
  schemaVersion: "1.0",
  pluginId: "example-plugin",
  pluginName: "Example Plugin",
  version: "1.0.0",
  keywords: ["example", "示例"],
  actions: [{
    id: "open",
    title: "Open Example",
    description: "Open the plugin's main view.",
    risk: "effect",
    route: { type: "command", commandId: "example-plugin:open" }
  }]
});

this.register(() => handle?.unregister());
```

The stable API is `app.plugins.plugins.cancip.api.v1`:

- `registerPluginAdapter(descriptor)`
- `unregisterPluginAdapter(pluginId)`
- `listPluginAdapters()`
- `getPluginAdapter(pluginId)`
- `executePluginAction(pluginId, actionId, input)`
- `refreshPluginCompatibility()`
- `getIntegrationGuide()`
- `receiveExternalContext(input)`

## Descriptor file

A plugin that cannot register at runtime may place `cancip-plugin.json` beside its `manifest.json`. Validate it against [cancip-plugin.schema.json](./cancip-plugin.schema.json). JSON descriptors are declarative and cannot contain callbacks.

## Routes

- `command`: stable Obsidian command ID, or an unambiguous command query.
- `api`: public `runtime.api` method, or a public runtime method with `target: "runtime"`.
- `ui`: stable selector or semantic label plus `click`, `input`, `select`, `toggle`, or `key` operation.
- `run`: runtime-only callback supplied by the owning plugin during registration.

Every action declares `risk`: `read`, `effect`, `write`, or `high`. Cancip tool calls continue through Cancip's confirmation/full-access handling. Direct public API calls do not bypass that boundary.

## Automatic compatibility

Without a dedicated adapter, Cancip inspects in this order:

1. Registered adapter.
2. `cancip-plugin.json`.
3. Public runtime compatibility descriptor.
4. Obsidian commands.
5. Public runtime/API methods.
6. Visible buttons, menu items, tabs, inputs, selects, checkboxes, and switches.
7. Plugin settings/data.
8. Local or web documentation.

UI fallback follows `observe -> act -> verify`. Ambiguous controls are not clicked. The DOM is scanned only for the current request; Cancip does not keep a global observer or run an LLM over every plugin at startup.

## UI compatibility

Expose stable `aria-label`, `title`, `data-*`, command IDs, and an observable completion state. Add a route `verify` condition when possible. Do not couple to private Cancip controllers or copy another plugin's internals. Complex or background work belongs in a public API; UI routes are appropriate for visible actions a user can perform.
