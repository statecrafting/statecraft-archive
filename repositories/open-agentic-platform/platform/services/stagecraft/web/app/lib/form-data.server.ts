/**
 * Parses form values from a request, supporting
 * application/json, application/x-www-form-urlencoded, multipart/form-data,
 * and a fallback for missing/unexpected Content-Type (e.g. when headers
 * are lost in the request pipeline).
 */
export async function getFormValues(
  request: Request
): Promise<Record<string, string>> {
  const contentType = request.headers.get("Content-Type") || "";

  if (contentType.includes("application/json")) {
    const json = (await request.json()) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(json).map(([k, v]) => [k, String(v ?? "")])
    );
  }

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const fd = await request.formData();
    return Object.fromEntries(
      [...fd.entries()].map(([k, v]) => [
        k,
        v instanceof File ? v.name : String(v),
      ])
    );
  }

  // Fallback: Content-Type missing or unexpected (e.g. stripped by proxy).
  // Parse body as URL-encoded string, which matches form submission format.
  const text = await request.text();
  if (!text.trim()) return {};

  try {
    const params = new URLSearchParams(text);
    return Object.fromEntries([...params.entries()]);
  } catch {
    return {};
  }
}
