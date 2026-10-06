import { EstadoSesion } from "@/components/shell/EstadoSesion";
import { ShellMovil } from "@/components/shell/ShellMovil";

export default function Inicio() {
  return (
    <ShellMovil titulo="Azul Chat">
      <EstadoSesion />
    </ShellMovil>
  );
}
