// Tipos mínimos de `http_ece` (dependencia de web-push) para el servicio de
// push de mentira de los tests, que descifra lo que recibe (RFC 8188/8291).
declare module "http_ece" {
  import type { ECDH } from "node:crypto";
  const ece: {
    decrypt(cuerpo: Buffer, parametros: { version: "aes128gcm"; privateKey: ECDH; authSecret: string }): Buffer;
  };
  export default ece;
}
