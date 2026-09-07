import { defineTool } from "@agoramcp/core";
import { z } from "zod";
import { checkVat, fetchStatus, MEMBER_STATES, normalizeVat } from "./client.ts";

export const checkVatNumberTool = defineTool({
  name: "check_vat_number",
  title: "Look up a VAT number (ΑΦΜ)",
  description:
    "Turn a VAT number into the name and address it is registered to, and say whether the registration is live. " +
    "This is the join for the other Greek sources: a ΚΗΜΔΗΣ contract award, a Διαύγεια expenditure decision and a Μίτος organisation record all identify a company by its ΑΦΜ and never by its name, and this is what names it. " +
    "`countryCode` defaults to EL, Greece — note that EU VAT writes Greece as EL, not GR. The number may be given with or without that prefix and with spaces or dashes; a Greek ΑΦΜ that lost its leading zero to a spreadsheet is restored to nine digits. " +
    "A Greek number is checked against its own check digit first, so a mistyped ΑΦΜ is reported as mistyped rather than as unregistered — upstream cannot tell those apart. " +
    "Not every member state discloses names: Greece returns the registered name and address, while Germany and others confirm only that the number is valid, and `nameDisclosed` says which happened. " +
    "An unregistered result means the number is not a live VAT registration today — it does not mean the company never existed, and a business below the VAT threshold or one that never traded across a border may hold an ΑΦΜ that VIES does not know. " +
    "This is a research lookup, not a formal VIES consultation: it carries no consultation number and is not proof of validation for an invoice or a tax filing.",
  inputSchema: {
    vatNumber: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .describe(
        "The VAT number, with or without its country prefix and with any spacing: '094014201', 'EL094014201', 'EL 094 014 201'. For Greece this is the ΑΦΜ.",
      ),
    countryCode: z
      .string()
      .trim()
      .length(2)
      .optional()
      .describe(
        `The member state that issued the number, as EU VAT writes it. Defaults to EL (Greece). One of: ${MEMBER_STATES.join(", ")}.`,
      ),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { vatNumber: "094014201" },
  async handler(input, context) {
    const vat = normalizeVat(input.vatNumber, input.countryCode ?? "EL");
    const result = await checkVat(vat, context.cache, context.ttl, context.signal);

    // A valid number with no name is the member state withholding it, not an
    // empty record — the distinction decides whether asking again would help.
    const nameDisclosed = result.registered ? result.name !== null : null;

    const notes: string[] = [];
    if (vat.note) notes.push(vat.note);
    if (result.registered && !nameDisclosed) {
      notes.push(
        `${vat.countryCode} confirms this registration but does not disclose the registered name or address through VIES. The number is valid; the identity must come from that country's own business register.`,
      );
    }
    if (!result.registered) {
      notes.push(
        `${vat.fullVatNumber} is not a live VAT registration in ${vat.countryCode} today. The number is well formed, so this is upstream's answer rather than a typo.`,
      );
    }

    return {
      ...result,
      nameDisclosed,
      notes,
    };
  },
});

export const listMemberStatesTool = defineTool({
  name: "list_member_states",
  title: "List VAT registers and whether they are answering",
  description:
    "List the EU VAT registers VIES can reach — the 27 member states plus XI, Northern Ireland — and whether each one is answering right now. " +
    "VIES holds no register of its own: it forwards every question to the country that issued the number, so a lookup that fails is usually that country's register being down rather than anything about the number. " +
    "Call this when check_vat_number reports a register unavailable, to see whether the outage is that one country or the whole service, and whether it is worth retrying. " +
    "Availability changes minute to minute and is reported live.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: {},
  async handler(_input, context) {
    const status = await fetchStatus(context.cache, context.ttl, context.signal);
    const unavailable = status.memberStates.filter((state) => !state.available);

    return {
      serviceAvailable: status.serviceAvailable,
      total: status.memberStates.length,
      unavailableCount: unavailable.length,
      unavailable: unavailable.map((state) => state.countryCode),
      memberStates: status.memberStates,
    };
  },
});

export const tools = [checkVatNumberTool, listMemberStatesTool];
