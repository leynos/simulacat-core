import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { simulation } from "../src/index.ts";

let basePort = 3330;
let host = "http://localhost";
let url = `${host}:${basePort}`;

describe.sequential("GET user endpoints", () => {
  let server;
  beforeAll(async () => {
    let app = simulation({
      initialState: {
        users: [],
        organizations: [{ login: "lovely-org" }],
        repositories: [{ owner: "lovely-org", name: "awesome-repo" }],
        branches: [{ name: "main" }],
        blobs: [],
      },
    });
    server = await app.listen(basePort);
  });
  afterAll(async () => {
    await server.ensureClose();
  });

  describe("/user/memberships/orgs", () => {
    it("validates with 200 response", async () => {
      let request = await fetch(`${url}/user/memberships/orgs`);
      let response = await request.json();
      expect(response.err).toBe(undefined);
      expect(request.status).toEqual(200);
      expect(response).toEqual([
        expect.objectContaining({
          organization: expect.objectContaining({ login: "lovely-org" }),
        }),
      ]);
    });
  });
});
