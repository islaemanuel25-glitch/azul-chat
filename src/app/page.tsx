import { PanelSesion } from "@/components/sesion/PanelSesion";
import { ShellMovil } from "@/components/shell/ShellMovil";

export default function Inicio() {
  return (
    <ShellMovil titulo="Azul Chat">
      <PanelSesion />
    </ShellMovil>
  );
}
