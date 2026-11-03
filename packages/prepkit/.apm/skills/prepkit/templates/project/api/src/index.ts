const port = Number(process.env.PORT ?? 3000);

const routes: Record<string, () => Response> = {
  "/api/health": () =>
    Response.json({ ok: true, service: "api", time: new Date().toISOString() }),
};

Bun.serve({
  port,
  hostname: "0.0.0.0",
  fetch(request) {
    const { pathname } = new URL(request.url);
    const handler = routes[pathname];
    return handler ? handler() : new Response("Not found", { status: 404 });
  },
});

console.log(`api listening on http://0.0.0.0:${port}`);
