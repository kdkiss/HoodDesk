import { expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/analyst/route";

it("rejects oversized analyst requests before provider execution", async () => {
  const request = new NextRequest("http://test/api/analyst", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payload: "x".repeat(70 * 1024) }),
  });

  const response = await POST(request);

  expect(response.status).toBe(413);
  expect(await response.json()).toMatchObject({
    error: "Analyst request is too large",
  });
});
