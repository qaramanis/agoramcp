"use server";

import { revalidatePath } from "next/cache";
import { createRequest } from "@/db/queries";
import { requesterHash } from "@/db/requester";

/** What the form hears back, keyed to the country it asked about. */
export type RequestState =
  | { kind: "idle" }
  | { kind: "created" | "duplicate"; code: string; requests: number }
  | { kind: "supported" | "unknown" | "error"; code: string };

/**
 * The form's Server Function. The code is validated as a shape here and as a
 * row in `createRequest`; the requester is identified from the request's own
 * headers, never from anything the form sent. A new row revalidates the page
 * so the count it renders is the one just made.
 */
export async function requestCountry(_previous: RequestState, form: FormData): Promise<RequestState> {
  const code = form.get("code");
  if (typeof code !== "string" || !/^[A-Z]{2}$/.test(code)) {
    return { kind: "error", code: typeof code === "string" ? code : "" };
  }

  try {
    const outcome = await createRequest(code, await requesterHash());
    if (outcome.kind === "created") revalidatePath("/country");
    return { ...outcome, code };
  } catch (error) {
    console.error("request: could not be filed", error);
    return { kind: "error", code };
  }
}
