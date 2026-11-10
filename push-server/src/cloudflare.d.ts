// The few Cloudflare Workers types this server uses (instead of installing @cloudflare/workers-types).

interface DurableObjectId {
  toString(): string
}

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId
  get(id: DurableObjectId): DurableObjectStub
}

interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  setAlarm(scheduledTime: number): Promise<void>
  deleteAlarm(): Promise<void>
}

interface DurableObjectState {
  storage: DurableObjectStorage
}
