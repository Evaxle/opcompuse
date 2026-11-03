import { Rpc } from "@opencode/plugin/rpc"

export const Opcompuse = Rpc.define({
  id: "opcompuse",
  methods: {
    status: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: {
          watchAlive: { type: "boolean" },
          watchAge: { type: "number" },
          digestAge: { type: "number" },
          running: { type: "boolean" },
          stoppedByOpu: { type: "boolean" },
          currentWindow: { type: "string" },
          currentProcess: { type: "string" },
          events: { type: "array", items: { type: "string" } },
          memory: {
            type: "object",
            properties: {
              places: { type: "number" },
              apps: { type: "number" },
              dir: { type: "string" },
            },
            required: ["places", "apps", "dir"],
            additionalProperties: true,
          },
          settings: { type: "object", additionalProperties: true },
          note: { type: "string" },
        },
        required: ["watchAlive", "watchAge", "digestAge", "running", "stoppedByOpu", "currentWindow", "currentProcess", "events", "memory", "settings", "note"],
        additionalProperties: false,
      },
    },
    stop: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
    },
    watch: {
      input: {
        type: "object",
        properties: { command: { type: "string", enum: ["on", "off", "status"] } },
        required: ["command"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
    },
    settingsGet: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: { type: "object", additionalProperties: true },
    },
    settingsSet: {
      input: { type: "object", additionalProperties: true },
      output: { type: "object", additionalProperties: true },
    },
    memorySummary: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: {
          dir: { type: "string" },
          places: { type: "array", items: { type: "string" } },
          apps: { type: "array", items: { type: "string" } },
        },
        required: ["dir", "places", "apps"],
        additionalProperties: false,
      },
    },
    memorySave: {
      input: {
        type: "object",
        properties: { key: { type: "string" }, value: { type: "string" }, kind: { type: "string", enum: ["place", "app", "note"] } },
        required: ["key", "value"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
})

