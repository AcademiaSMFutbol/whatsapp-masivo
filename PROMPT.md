# PROMPT.md – Contexto dinámico del proyecto

> Cuando cambies de tarea, dile a Claude:
> **"Lee PROMPT.md para entender los objetivos actuales y luego ayúdame a [tarea]."**

---

## Estado actual ✅

| Feature | Estado |
|---|---|
| Limpieza robusta de números (Excel/Sheets) | ✅ Funciona |
| Etiquetas editables por número (borrar individual) | ✅ Funciona |
| Editor de mensaje con personalización {nombre} | ✅ Funciona |
| Generador IA vía API Groq / Llama-3 | ✅ Funciona |
| API Key guardada en `sessionStorage` (no en servidor) | ✅ Seguro |
| Plantillas guardadas en `localStorage` | ✅ Funciona |
| Envío secuencial con delay configurable (wa.me) | ✅ Funciona |
| Modo bulk (generar todos los links a la vez) | ✅ Funciona |
| Log de envíos en pantalla | ✅ Funciona |
| Diseño responsive / mobile-first | ✅ Funciona |

---

## Backlog 📋

- [ ] **Importar CSV**: botón para cargar archivo `.csv` y extraer columna de teléfonos
- [ ] **Personalización avanzada**: variables `{nombre}`, `{equipo}`, `{fecha}` mapeadas desde columnas del CSV
- [ ] **Historial de envíos**: guardar en `localStorage` los números contactados + fecha
- [ ] **Grupos / segmentos**: etiquetar contactos por categoría (Sub-10, Sub-12, padres, etc.)
- [ ] **Modo test**: enviar solo al primer número antes de lanzar el batch completo
- [ ] **Reenviar fallidos**: marcar los que el usuario no completó y poder relanzarlos
- [ ] **Contador de caracteres** en el textarea de mensaje
- [ ] **Exportar log** a CSV

---

## Restricciones ⚠️

- No usar librerías que requieran `npm install`. Solo CDN o Vanilla JS.
- La API key de Groq **no se almacena en `localStorage`**, solo en `sessionStorage` (se borra al cerrar la pestaña).
- No hardcodear ninguna clave en el código fuente.
- Mantener todo en un solo directorio (sin build step): `index.html`, `style.css`, `app.js`.
- Compatibilidad: Chrome/Edge/Firefox modernos. No es necesario soporte IE.

---

## Stack técnico

- **Frontend**: Vanilla JS (ES2020+), HTML5, CSS3
- **IA**: [Groq API](https://console.groq.com) → modelo `llama3-8b-8192`
- **Almacenamiento**: `localStorage` (plantillas) + `sessionStorage` (API key sesión)
- **Envío**: Links `https://wa.me/{numero}?text={mensaje}` abiertos via `window.open`

---

## Notas de negocio

- Herramienta interna para **Academia SM Fútbol**.
- Uso principal: avisos a padres/jugadores (partidos, entrenamientos, eventos).
- Operado por una sola persona desde móvil o PC.
- Los números llegan habitualmente copiados de Google Sheets con formato sucio.
