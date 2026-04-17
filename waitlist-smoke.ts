import { createEventService } from "./src/service/EventService";
import type { IEventRepository } from "./src/repository/EventRepository";
import type { CreateEventData, IEvent } from "./src/types/EventTypes";
import { Ok, Err } from "./src/lib/result";
import { EventNotFoundError } from "./src/lib/errors";

class MemRepo implements IEventRepository {
  private events = new Map<number, IEvent>();
  private nextId = 1;
  async getAllEvents() { return Ok(Array.from(this.events.values())); }
  async getEventById(id: number) {
    const e = this.events.get(id);
    return e ? Ok(e) : Err(EventNotFoundError(`no ${id}`));
  }
  async createEvent(data: CreateEventData) {
    const id = this.nextId++;
    const e: IEvent = {
      ...data,
      id,
      attendees: [...data.attendees],
      createdAt: new Date(),
      updatedAt: new Date(),
      category: data.category ?? null,
      capacity: data.capacity ?? null,
    } as IEvent;
    this.events.set(id, e);
    return Ok(e);
  }
  async updateEvent(id: number, patch: Partial<IEvent>) {
    const e = this.events.get(id);
    if (!e) return Err(EventNotFoundError(`no ${id}`));
    const merged = { ...e, ...patch } as IEvent;
    this.events.set(id, merged);
    return Ok(merged);
  }
  async deleteEvent() { return Ok(undefined as void); }
  async findUserRsvp(eventId: number, userId: string) {
    const e = this.events.get(eventId);
    if (!e) return Err(EventNotFoundError(`no ${eventId}`));
    const r = e.attendees.find((a) => a.userId === userId);
    return r ? Ok(r) : Err(EventNotFoundError(`no rsvp`));
  }
}

const logger = { info: (_: string) => {}, warn: (_: string) => {}, error: (_: string) => {} };

async function main() {
  const repo = new MemRepo();
  const svc = createEventService(repo, logger as any);

  const created = await svc.createEvent({
    title: "Capacity two", description: "d", location: "l",
    capacity: 2, status: "PUBLISHED",
    startDatetime: new Date(Date.now() + 86_400_000),
    endDatetime: new Date(Date.now() + 2 * 86_400_000),
    organizerId: "org1", attendees: [],
  } as CreateEventData);
  if (!created.ok) throw new Error("create failed");
  const id = created.value.id;

  const r1 = await svc.toggleRsvp(id, "u1");
  const r2 = await svc.toggleRsvp(id, "u2");
  const r3 = await svc.toggleRsvp(id, "u3");
  const r4 = await svc.toggleRsvp(id, "u4");
  console.log("u1:", r1.ok && r1.value.rsvpStatus);
  console.log("u2:", r2.ok && r2.value.rsvpStatus);
  console.log("u3:", r3.ok && r3.value.rsvpStatus);
  console.log("u4:", r4.ok && r4.value.rsvpStatus);

  const qp3 = await svc.getQueuePosition(id, "u3");
  const qp4 = await svc.getQueuePosition(id, "u4");
  const qp1 = await svc.getQueuePosition(id, "u1");
  console.log("qp u3 (expect 1):", qp3.ok && qp3.value);
  console.log("qp u4 (expect 2):", qp4.ok && qp4.value);
  console.log("qp u1 (expect null):", qp1.ok && qp1.value);

  const cancel = await svc.toggleRsvp(id, "u1");
  console.log("u1 after cancel:", cancel.ok && cancel.value.rsvpStatus);

  const after = await repo.getEventById(id);
  if (!after.ok) throw new Error("fetch failed");
  const u3 = after.value.attendees.find((a) => a.userId === "u3");
  const u4 = after.value.attendees.find((a) => a.userId === "u4");
  console.log("u3 after u1 cancel (expect GOING):", u3?.rsvpStatus);
  console.log("u4 after u1 cancel (expect WAITLISTED):", u4?.rsvpStatus);

  const qp4b = await svc.getQueuePosition(id, "u4");
  console.log("qp u4 after promotion (expect 1):", qp4b.ok && qp4b.value);

  const rejoin = await svc.toggleRsvp(id, "u1");
  console.log("u1 re-toggle (expect WAITLISTED):", rejoin.ok && rejoin.value.rsvpStatus);
  const qp1b = await svc.getQueuePosition(id, "u1");
  console.log("qp u1 after re-toggle (expect 2):", qp1b.ok && qp1b.value);
}

main().catch((e) => { console.error(e); process.exit(1); });
