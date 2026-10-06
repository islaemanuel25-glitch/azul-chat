/**
 * Indica que todavía no hay sesión. No muestra ni simula datos del ERP: hasta
 * que exista el login, Azul Chat no sabe quién es la persona ni qué puede ver.
 */
export function EstadoSesion() {
  return (
    <section className="ac-tarjeta" aria-live="polite">
      <span className="ac-pastilla">
        <span className="ac-pastilla__punto" aria-hidden="true" />
        Sin sesión
      </span>
      <h2 className="ac-tarjeta__titulo">Todavía no iniciaste sesión</h2>
      <p className="ac-tarjeta__texto">
        El ingreso a Azul Chat todavía no está disponible. Cuando lo esté, vas a poder ver tus conversaciones y
        consultar el ERP desde acá.
      </p>
    </section>
  );
}
