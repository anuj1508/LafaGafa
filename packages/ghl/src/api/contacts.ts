import { z } from "zod";
import type { GhlClient } from "../client.js";

/** Contacts is pinned to a different API version than Conversations. This is not a typo. */
const VERSION = "2021-07-28";

const contactSchema = z.object({
  id: z.string(),
  locationId: z.string().optional(),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  email: z.string().nullish(),
  phone: z.string().nullish(),
  tags: z.array(z.string()).default([]),
});

export type Contact = z.infer<typeof contactSchema>;

const createContactResponseSchema = z.object({ contact: contactSchema });

const upsertResponseSchema = z.object({ contact: contactSchema, new: z.boolean().optional() });

export interface UpdateContactInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  assignedTo?: string;
  /** Custom fields are addressed by id, not by name. */
  customFields?: Array<{ id: string; value: string }>;
}

export interface CreateContactInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  source?: string;
}

export class ContactsApi {
  constructor(
    private readonly client: GhlClient,
    private readonly locationId: string,
  ) {}

  async create(input: CreateContactInput): Promise<Contact> {
    const response = await this.client
      .requests(this.locationId)
      .post(
        "/contacts/",
        { locationId: this.locationId, ...input },
        { headers: { Version: VERSION } },
      );
    return createContactResponseSchema.parse(response.data).contact;
  }

  /** Only present fields are sent: GHL reads an explicit null as "clear this". */
  async update(contactId: string, patch: UpdateContactInput): Promise<Contact> {
    const response = await this.client
      .requests(this.locationId)
      .put(`/contacts/${contactId}`, patch, { headers: { Version: VERSION } });
    return createContactResponseSchema.parse(response.data).contact;
  }

  /**
   * Writes a field the CRM deduplicates on, and reports which contact survived.
   * GHL merges by email and phone; upsert is the only call that says which record won.
   */
  async upsert(
    input: UpdateContactInput & { email?: string; phone?: string },
  ): Promise<{ contact: Contact; isNew: boolean }> {
    const response = await this.client
      .requests(this.locationId)
      .post(
        "/contacts/upsert",
        { locationId: this.locationId, ...input },
        { headers: { Version: VERSION } },
      );
    const parsed = upsertResponseSchema.parse(response.data);
    return { contact: parsed.contact, isNew: parsed.new ?? false };
  }

  /** Free text, timestamped, and the first thing a colleague sees when they open the record. */
  async addNote(contactId: string, body: string): Promise<void> {
    await this.client
      .requests(this.locationId)
      .post(`/contacts/${contactId}/notes`, { body }, { headers: { Version: VERSION } });
  }

  async get(contactId: string): Promise<Contact> {
    const response = await this.client
      .requests(this.locationId)
      .get(`/contacts/${contactId}`, { headers: { Version: VERSION } });
    return createContactResponseSchema.parse(response.data).contact;
  }
}
