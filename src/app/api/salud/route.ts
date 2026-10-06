// GET /api/salud — el proceso está vivo. Nada más.
//
// No dice si el ERP está configurado ni si responde: eso es información sobre
// la integración y esta ruta no tiene autenticación.

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, servicio: "azul-chat" }, { headers: { "Cache-Control": "no-store" } });
}
