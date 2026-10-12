// Tanda 15: desde que existen los accesos, Azul Chat está CERRADO por defecto:
// sin AZUL_CHAT_ADMINISTRADORES ni un acceso guardado, nadie entra. Los tests
// de antes de la Tanda 15 prueban lo que hace la app con alguien que entra a
// todo, así que sus personas del ERP de mentira son administradoras (lo mismo
// que tenían antes). Lo que pasa con una persona común lo prueba
// test/db/accesos.test.ts, que NO usa esta lista.

/** Todas las personas del ERP de mentira que usan los tests: 7, 8, 9 (adminGlobal), 11 (encargado), 12 (cajero) y las 10 de la ingesta. */
export const ADMINISTRADORES_DE_PRUEBA = [7, 8, 9, 11, 12, ...Array.from({ length: 10 }, (_, i) => 1000 + i)].join(",");
