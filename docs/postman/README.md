# Archie Remote MCP Postman Collection

Import `archie-remote-mcp.postman_collection.json` into Postman to test the
remote MCP endpoint without storing secrets in the repo.

Set these collection variables after import:

- `archie_base_url`: `http://localhost:3001`
- `archie_mcp_token`: the token generated from Archie settings
- `archie_app_id`: optional; `List Apps` will fill this with the first app when empty

When using `localhost` from Postman Web, select the Postman Desktop Agent or
use the Postman desktop app. The Postman Cloud Agent cannot reach services on
your machine and can fail with `No addresses found`.

Useful flow:

1. Run `Initialize`
2. Run `List Tools`
3. Run `List Apps`
4. Run read-only tools like `List Skills`, `List Tasks`, or `Ask Project`
5. Run `Start Task`, then poll with `Get Task Status`

`Start Task` and `Continue Task` save `archie_run_id`,
`archie_conversation_id`, and `archie_task_id` from the response when present.
