// CANDADO: lo que hace segura la imagen y el despliegue de producción.
//
// Se mira la configuración RESUELTA (`docker compose config`, que ya no trae
// comentarios ni anclas) y el Dockerfile sin comentarios. Cada regla tiene su
// contraprueba abajo: se rompe a propósito y se ve el rojo.
//
// Lo que no se puede ver desde acá —que la imagen construida corra como node,
// no traiga .env y no pueda escribir su código— lo comprueba el job `imagen` de
// la CI sobre la imagen real.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const RAIZ = path.resolve(import.meta.dirname, "../..");
const leer = (f: string) => readFileSync(path.join(RAIZ, f), "utf8");

type Servicio = {
  image?: string;
  build?: unknown;
  command?: unknown;
  entrypoint?: unknown;
  ports?: { host_ip?: string; target: number; published?: string }[];
  networks?: Record<string, unknown>;
  env_file?: { path: string }[];
  environment?: Record<string, string | null>;
  volumes?: { type: string; source?: string; target: string }[];
  read_only?: boolean;
  healthcheck?: { test?: string[] };
  network_mode?: string;
  privileged?: boolean;
  cap_drop?: string[];
  deploy?: { resources?: { limits?: { cpus?: string; memory?: string } } };
};
type Compose = {
  name: string;
  services: Record<string, Servicio>;
  networks?: Record<string, { name?: string; external?: boolean; internal?: boolean }>;
  volumes?: Record<string, { external?: boolean; name?: string }>;
};

/**
 * La configuración resuelta. Se resuelve en un directorio descartable, con un
 * app.env y un db.env que traen cada uno un CENTINELA: en la configuración
 * resuelta, Compose vuelca cada archivo en el `environment` del servicio que lo
 * lee, así que el centinela dice qué archivo llega a qué contenedor. No depende
 * de `--no-env-resolution`, que el Compose del runner de GitHub no respeta.
 */
function composeResuelto(): Compose {
  const dir = mkdtempSync(path.join(tmpdir(), "azul-compose-"));
  try {
    copyFileSync(path.join(RAIZ, "docker-compose.prod.yml"), path.join(dir, "docker-compose.prod.yml"));
    writeFileSync(path.join(dir, "app.env"), `${CENTINELA_APP}=1\n`);
    writeFileSync(path.join(dir, "db.env"), `${CENTINELA_DB}=1\n`);
    const salida = execFileSync("docker", ["compose", "-f", "docker-compose.prod.yml", "config", "--format", "json"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, AZUL_CHAT_IMAGE: "ghcr.io/islaemanuel25-glitch/azul-chat:0123456789abcdef0123456789abcdef01234567" },
    });
    return JSON.parse(salida) as Compose;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const CENTINELA_APP = "CENTINELA_DE_APP_ENV";
const CENTINELA_DB = "CENTINELA_DE_DB_ENV";

const VARIABLES_APP = [
  "DATABASE_URL",
  "ERP_BASE_URL",
  "AZUL_CHAT_ORIGEN_PUBLICO",
  "AZUL_CHAT_INSTALACION_ID",
  "AZUL_CHAT_INTEGRACION_SECRET",
  "AZUL_CHAT_TOKEN_ENCRYPTION_KEY",
];

/** Las violaciones del compose. Vacío = cumple. */
function violacionesCompose(c: Compose): string[] {
  const v: string[] = [];
  const app = c.services["azul-chat-app"];
  const db = c.services["azul-chat-db"];
  if (c.name !== "azul-chat") v.push("proyecto");
  if (!app || !db || Object.keys(c.services).length !== 2) return [...v, "servicios"];

  // Aislamiento del ERP: ninguna red ni volumen externo, nada que nombre al ERP.
  for (const [k, red] of Object.entries(c.networks ?? {})) {
    if (red.external) v.push(`red externa ${k}`);
    if (!red.name?.startsWith("azul-chat-")) v.push(`red sin nombre propio ${k}`);
  }
  for (const [k, vol] of Object.entries(c.volumes ?? {})) if (vol.external) v.push(`volumen externo ${k}`);
  if (/erpazul/i.test(JSON.stringify(c))) v.push("nombra al ERP");
  for (const [k, s] of Object.entries(c.services)) {
    if (s.network_mode) v.push(`${k}: network_mode`);
    if (s.privileged) v.push(`${k}: privileged`);
  }

  // La base: sin puerto publicado, solo en la red interna, que no tiene salida.
  if (db.ports?.length) v.push("db publica puertos");
  if (JSON.stringify(Object.keys(db.networks ?? {})) !== '["interna"]') v.push("db fuera de la red interna");
  if (!c.networks?.interna?.internal) v.push("red interna con salida");
  if (!db.image?.startsWith("postgres:16@sha256:")) v.push("db sin postgres:16 fijado");
  if (!db.volumes?.some((x) => x.target === "/var/lib/postgresql/data" && x.type === "bind" && x.source?.endsWith("/pgdata"))) {
    v.push("db sin datos persistentes propios");
  }

  // La app: solo en 127.0.0.1:3100.
  const p = app.ports ?? [];
  if (p.length !== 1 || p[0]?.host_ip !== "127.0.0.1" || p[0]?.published !== "3100" || p[0]?.target !== 3000) v.push("app publicada fuera de 127.0.0.1:3100");

  // La imagen: por referencia, sin build, sin latest; nada de migraciones al arrancar.
  if (app.build) v.push("app con build");
  if (!app.image || /:latest$/.test(app.image) || !/:[0-9a-f]{40}$/.test(app.image)) v.push("app sin imagen por SHA");
  if (app.command || app.entrypoint) v.push("app redefine el arranque");
  if (app.read_only !== true) v.push("app sin read_only");
  if (!app.cap_drop?.includes("ALL")) v.push("app con capacidades");

  // Entornos separados: la base no recibe nada de la app.
  const de = (s: Servicio) => Object.keys(s.environment ?? {});
  if (!de(db).includes(CENTINELA_DB)) v.push("db no lee db.env");
  if (de(db).includes(CENTINELA_APP)) v.push("db recibe app.env");
  if (!de(app).includes(CENTINELA_APP)) v.push("app no lee app.env");
  if (de(app).includes(CENTINELA_DB)) v.push("app recibe db.env");
  for (const k of Object.keys(db.environment ?? {})) if (VARIABLES_APP.includes(k) || /AZUL|ERP/.test(k)) v.push(`db recibe ${k}`);
  // Ni secretos ni APP_BUILD_ID escritos en el compose.
  for (const [k, s] of Object.entries(c.services)) {
    for (const [nombre, valor] of Object.entries(s.environment ?? {})) {
      if (nombre === "APP_BUILD_ID") v.push(`${k}: pisa APP_BUILD_ID`);
      if (/SECRET|KEY|PASSWORD|DATABASE_URL/.test(nombre) && valor) v.push(`${k}: secreto escrito ${nombre}`);
    }
  }

  // Healthchecks y límites.
  if (!JSON.stringify(app.healthcheck?.test ?? []).includes("/api/salud")) v.push("app sin healthcheck de /api/salud");
  if (!JSON.stringify(db.healthcheck?.test ?? []).includes("pg_isready")) v.push("db sin healthcheck");
  for (const [k, s] of Object.entries(c.services)) if (!s.deploy?.resources?.limits?.memory || !s.deploy.resources.limits.cpus) v.push(`${k}: sin límites`);
  return v;
}

describe("el compose de producción", () => {
  const c = composeResuelto();

  it("aislado del ERP, base sin puerto, app solo en 127.0.0.1:3100, entornos separados", () => {
    assert.deepEqual(violacionesCompose(c), []);
  });

  it("CONTRAPRUEBA: cada regla se pone roja cuando se rompe", () => {
    const copia = () => structuredClone(c);
    const casos: [string, (x: Compose) => void][] = [
      ["db publica puertos", (x) => (x.services["azul-chat-db"]!.ports = [{ host_ip: "0.0.0.0", target: 5432, published: "5432" }])],
      ["red externa erpazul_default", (x) => (x.networks!.erpazul_default = { name: "erpazul_default", external: true })],
      ["nombra al ERP", (x) => (x.services["azul-chat-app"]!.environment!.DATABASE_URL = "postgresql://u@erpazul_db/erpazul")],
      ["red interna con salida", (x) => (x.networks!.interna!.internal = false)],
      ["app publicada fuera de 127.0.0.1:3100", (x) => (x.services["azul-chat-app"]!.ports![0]!.host_ip = "0.0.0.0")],
      ["app sin imagen por SHA", (x) => (x.services["azul-chat-app"]!.image = "ghcr.io/islaemanuel25-glitch/azul-chat:latest")],
      ["app con build", (x) => (x.services["azul-chat-app"]!.build = { context: "." })],
      ["app redefine el arranque", (x) => (x.services["azul-chat-app"]!.command = ["sh", "-c", "prisma migrate deploy && node server.js"])],
      ["db recibe app.env", (x) => (x.services["azul-chat-db"]!.environment![CENTINELA_APP] = "1")],
      ["db no lee db.env", (x) => delete x.services["azul-chat-db"]!.environment![CENTINELA_DB]],
      ["app recibe db.env", (x) => (x.services["azul-chat-app"]!.environment![CENTINELA_DB] = "1")],
      ["db recibe AZUL_CHAT_INTEGRACION_SECRET", (x) => (x.services["azul-chat-db"]!.environment!.AZUL_CHAT_INTEGRACION_SECRET = null)],
      ["azul-chat-app: pisa APP_BUILD_ID", (x) => (x.services["azul-chat-app"]!.environment!.APP_BUILD_ID = "x")],
      ["azul-chat-app: secreto escrito AZUL_CHAT_TOKEN_ENCRYPTION_KEY", (x) => (x.services["azul-chat-app"]!.environment!.AZUL_CHAT_TOKEN_ENCRYPTION_KEY = "abc")],
      ["app sin read_only", (x) => delete x.services["azul-chat-app"]!.read_only],
      ["azul-chat-db: sin límites", (x) => delete x.services["azul-chat-db"]!.deploy],
    ];
    for (const [esperada, romper] of casos) {
      const x = copia();
      romper(x);
      assert.ok(violacionesCompose(x).includes(esperada), `${esperada}: ${JSON.stringify(violacionesCompose(x))}`);
    }
  });
});

/** El Dockerfile sin comentarios ni continuaciones de línea. */
const sinComentariosDocker = (t: string) =>
  t
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n")
    .replace(/\\\n/g, " ");

function violacionesDockerfile(texto: string): string[] {
  const d = sinComentariosDocker(texto);
  const v: string[] = [];
  const etapas = d.split(/^FROM\s/m);
  const final = etapas.at(-1) ?? "";
  if (!/^\S+\s+AS\s+runtime\b/m.test(final)) v.push("la última etapa no es runtime");
  const usuarios = [...final.matchAll(/^USER\s+(\S+)/gm)].map((m) => m[1]);
  if (usuarios.at(-1) !== "node") v.push("runtime no corre como node");
  if (!/^CMD\s+\["node",\s*"server\.js"\]\s*$/m.test(final)) v.push("CMD distinto de node server.js");
  if (/^ENTRYPOINT/m.test(final)) v.push("ENTRYPOINT en runtime");
  if (/migrate/.test(final.match(/^(CMD|ENTRYPOINT).*$/gm)?.join("\n") ?? "")) v.push("migra al arrancar");
  if (!/^ENV\s.*NODE_ENV=production/m.test(final)) v.push("sin NODE_ENV=production");
  if (!/^ARG NODE_IMAGE=node:22-bookworm-slim@sha256:[0-9a-f]{64}$/m.test(d)) v.push("base sin digest");
  if (/^COPY\s+\.\s/m.test(d)) v.push("COPY de todo el contexto");
  if (/^(ENV|ARG)\s+\S*(SECRET|KEY|PASSWORD|DATABASE_URL)/m.test(d)) v.push("secreto en ARG/ENV");
  if (!/grep -Eq '\^\[0-9a-f\]\{40\}\$'/.test(d)) v.push("APP_BUILD_ID sin validar");
  if (!/^ENV APP_BUILD_ID=\$\{APP_BUILD_ID\}/m.test(final)) v.push("APP_BUILD_ID no llega al runtime");
  return v;
}

describe("el Dockerfile", () => {
  const dockerfile = leer("Dockerfile");

  it("runtime como node, node server.js, sin migrar al arrancar, base fijada, sin secretos", () => {
    assert.deepEqual(violacionesDockerfile(dockerfile), []);
  });

  it("CONTRAPRUEBA: cada regla se pone roja cuando se rompe", () => {
    const casos: [string, string][] = [
      ["runtime no corre como node", dockerfile.replace(/^USER node$/m, "USER root")],
      ["migra al arrancar", dockerfile.replace('CMD ["node", "server.js"]', 'CMD ["sh", "-c", "prisma migrate deploy && node server.js"]')],
      ["CMD distinto de node server.js", dockerfile.replace('CMD ["node", "server.js"]', 'CMD ["npm", "start"]')],
      ["base sin digest", dockerfile.replace(/@sha256:[0-9a-f]{64}/, "")],
      ["COPY de todo el contexto", dockerfile.replace("COPY src ./src", "COPY . .")],
      ["secreto en ARG/ENV", dockerfile.replace("ENV NODE_ENV=production", "ENV AZUL_CHAT_INTEGRACION_SECRET=x NODE_ENV=production")],
      ["APP_BUILD_ID no llega al runtime", dockerfile.replace("ENV APP_BUILD_ID=${APP_BUILD_ID}", "")],
    ];
    for (const [esperada, roto] of casos) {
      assert.notEqual(roto, dockerfile, `el reemplazo de "${esperada}" no se aplicó`);
      assert.ok(violacionesDockerfile(roto).includes(esperada), `${esperada}: ${JSON.stringify(violacionesDockerfile(roto))}`);
    }
  });

  it(".dockerignore es lista blanca y deja afuera todo archivo de entorno", () => {
    const lineas = leer(".dockerignore").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    assert.equal(lineas[0], "*");
    assert.ok(lineas.includes("**/.env") && lineas.includes("**/.env.*"));
    // Lo que se deja pasar es código y configuración de build, nada más.
    const permitidos = lineas.filter((l) => l.startsWith("!"));
    for (const p of permitidos) assert.match(p, /^!(package(-lock)?\.json|next\.config\.ts|tsconfig\.json|src\/\*\*|prisma\/|ops\/prisma-cli\/package(-lock)?\.json)/, p);
  });
});

describe("el CLI de Prisma de la imagen", () => {
  it("es la misma versión que @prisma/client y que el CLI de desarrollo, fijada por lockfile", () => {
    const raiz = JSON.parse(leer("package.json"));
    const cli = JSON.parse(leer("ops/prisma-cli/package.json"));
    const lock = JSON.parse(leer("ops/prisma-cli/package-lock.json"));
    const cliente = raiz.dependencies["@prisma/client"];
    assert.match(cliente, /^\d+\.\d+\.\d+$/, "versión exacta, sin rango");
    assert.equal(raiz.devDependencies.prisma, cliente);
    assert.equal(cli.dependencies.prisma, cliente);
    assert.equal(lock.packages["node_modules/prisma"].version, cliente);
    assert.match(lock.packages["node_modules/prisma"].integrity, /^sha512-/);
  });
});

describe("los ejemplos de entorno de producción", () => {
  const SECRETOS = /^(DATABASE_URL|AZUL_CHAT_INTEGRACION_SECRET|AZUL_CHAT_TOKEN_ENCRYPTION_KEY|AZUL_CHAT_INSTALACION_ID|POSTGRES_PASSWORD)=/;

  it("traen las variables, sin ningún valor secreto", () => {
    const app = leer("ops/produccion/app.env.example");
    const db = leer("ops/produccion/db.env.example");
    const asignaciones = (t: string) => t.split("\n").filter((l) => /^[A-Z_]+=/.test(l));
    for (const l of [...asignaciones(app), ...asignaciones(db)]) {
      if (SECRETOS.test(l)) assert.match(l, /=$/, `con valor: ${l.split("=")[0]}`);
    }
    assert.deepEqual(asignaciones(app).map((l) => l.split("=")[0]).sort(), [...VARIABLES_APP].sort());
    assert.deepEqual(asignaciones(db).map((l) => l.split("=")[0]).sort(), ["POSTGRES_DB", "POSTGRES_PASSWORD", "POSTGRES_USER"]);
    assert.ok(asignaciones(app).includes("ERP_BASE_URL=https://operix.cloud"));
    assert.ok(asignaciones(app).includes("AZUL_CHAT_ORIGEN_PUBLICO=https://chat.operix.cloud"));
    // APP_BUILD_ID viene en la imagen; si estuviera acá, /api/version mentiría.
    assert.equal(/^APP_BUILD_ID=/m.test(app), false);
  });

  it("git ignora los entornos reales y los datos de producción", () => {
    const ignorado = (f: string) => {
      try {
        execFileSync("git", ["check-ignore", "-q", "--no-index", f], { cwd: RAIZ });
        return true;
      } catch {
        return false;
      }
    };
    for (const f of ["app.env", "db.env", "pgdata/PG_VERSION", "backups-azul-chat/x.sql.gz"]) assert.equal(ignorado(f), true, f);
    for (const f of ["ops/produccion/app.env.example", "ops/produccion/db.env.example"]) assert.equal(ignorado(f), false, f);
  });
});
