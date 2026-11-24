<div align="center">

# PIXEL**DECK**

### Tu propio "Spotify" con tu música de siempre

Sube tu colección a la nube y escúchala desde un reproductor retro estilo hi-fi en **Mac** y **Android**.

![Electron](https://img.shields.io/badge/Mac-Electron-ffb43a?style=for-the-badge&logo=electron&logoColor=white&labelColor=1b1c21)
![Android](https://img.shields.io/badge/Android-Capacitor%20%2B%20React-ffb43a?style=for-the-badge&logo=android&logoColor=white&labelColor=1b1c21)
![Cloudflare R2](https://img.shields.io/badge/Nube-Cloudflare%20R2-ffb43a?style=for-the-badge&logo=cloudflare&logoColor=white&labelColor=1b1c21)
![Licencia MIT](https://img.shields.io/badge/Licencia-MIT-ffb43a?style=for-the-badge&labelColor=1b1c21)

![Pixel Deck](docs/img/portada.png)

</div>

---

## ✨ Qué hace

| | |
|---|---|
| ☁️ **Tu música en la nube** | Toda tu colección en Cloudflare R2, privada. 45 GB cuestan unos **US$0,50 al mes** y escucharla no tiene costo extra. |
| 🖥️ **App para Mac** | Arrastras carpetas desde tu disco y se arma la lista, o reproduces directo desde la nube. Si desconectas el disco, sigue sonando desde la nube. |
| 📱 **App para Android** | Toda la biblioteca con buscador y filtro por carpetas, y descargas para escuchar **sin señal**. |
| 🎚️ **Sonido de verdad** | Ecualizador de 10 bandas con **PRE**, **MASTER** y limitador, presets, espectro y medidores VU reales. |
| 🎛️ **Transiciones y modo fiesta** | Las canciones se mezclan entre sí. En **modo fiesta**, la mezcla es estilo DJ (cambio de graves), el orden es aleatorio sin repetir y las luces siguen el ritmo. |
| 🔒 **Privado** | Sin servidores propios ni cuentas extra: las claves quedan solo en tus dispositivos, y en el celular se usa una de **solo lectura**. |

---

## 📸 Capturas

### Android

<table>
  <tr>
    <td align="center"><img src="docs/img/android-reproduciendo.png" width="230"><br><b>Reproduciendo</b></td>
    <td align="center"><img src="docs/img/android-carpetas.png" width="230"><br><b>Filtro por carpetas</b></td>
    <td align="center"><img src="docs/img/android-busqueda.png" width="230"><br><b>Búsqueda</b></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/img/android-sonido.png" width="230"><br><b>Sonido y ecualizador</b></td>
    <td align="center"><img src="docs/img/android-fiesta.png" width="230"><br><b>Modo fiesta mezclando</b></td>
    <td align="center"><img src="docs/img/android-descargas.png" width="230"><br><b>Descargas sin señal</b></td>
  </tr>
</table>

Al bajar por la lista, la parte de arriba se achica para dejar más espacio a las canciones:

<div align="center"><img src="docs/img/cabecera-compacta.png" width="560"></div>

### Mac

<div align="center"><img src="docs/img/escritorio.png" width="420"></div>

---

## 🧩 Cómo funciona

```mermaid
flowchart LR
    D[💽 Tu disco duro] -- rclone --> R2[(☁️ Cloudflare R2<br/>bucket privado)]
    R2 -- "streaming firmado" --> M[🖥️ Pixel Deck Mac]
    R2 -- "streaming firmado<br/>o descarga" --> A[📱 Pixel Deck Android]
    D -. "también puede leer<br/>el disco directo" .-> M
```

- Las apps hablan directo con R2 usando la API compatible con S3, con URLs firmadas que expiran.
- **No hay backend ni servidor propio** que mantener.
- En Android, el audio pasa por un motor de **dos bandejas** (como una mesa de DJ) para las mezclas, el ecualizador y los medidores.

---

## 🚀 Instalación

> Necesitas: una cuenta de Cloudflare, **Node 22+**, y para Android, **Android Studio**.

<details>
<summary><b>1. Crear tu almacenamiento en Cloudflare R2</b></summary>

1. En Cloudflare, activa **R2 Object Storage**. Pide un método de pago, pero no cobra si usas poco: 10 GB gratis al mes.
2. Crea un bucket (por ejemplo, `mi-musica`) con clase **Standard** y acceso público **desactivado**.
3. Copia tu **S3 API endpoint** (en R2 → Account Details): `https://TU-ID.r2.cloudflarestorage.com`

**Claves** (R2 → *Manage API Tokens* → *Create API token*):
- Para subir música y para la app de Mac: **Object Read & Write**, solo para tu bucket.
- Para el celular: otra clave con **Object Read only**, solo para tu bucket.

Guarda el *Access Key ID* y el *Secret Access Key*, porque se muestran una sola vez. **Nunca los subas a GitHub ni los compartas.**

**CORS** (necesario para la app Android). En tu bucket → *Settings* → *CORS Policy* → *Add*:
```json
[
  {
    "AllowedOrigins": ["https://localhost"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["Content-Length", "Content-Range", "Accept-Ranges"],
    "MaxAgeSeconds": 86400
  }
]
```
Esto deja que la app procese el audio (ecualizador, medidores, mezclas). El bucket sigue siendo privado.
</details>

<details>
<summary><b>2. Subir tu música con rclone</b></summary>

```bash
brew install rclone
rclone config create r2 s3 provider=Cloudflare \
  access_key_id=TU_ACCESS_KEY secret_access_key=TU_SECRET_KEY \
  endpoint=https://TU-ID.r2.cloudflarestorage.com acl=private no_check_bucket=true

rclone ls r2:mi-musica      # sin errores = conectado

caffeinate -i rclone copy "/ruta/a/tu/musica" r2:mi-musica \
  --progress --transfers 8 --exclude "._*" --exclude ".DS_Store"
```
- Si se corta, vuelve a correr el mismo comando: sigue desde donde quedó.
- Las carpetas de primer nivel (`ROCK/`, `REGGAETON/`, `ROMANTICA/`…) aparecen como filtros en las apps.
- 💡 Sube cerca del router o con cable de red: la velocidad cambia muchísimo.
</details>

<details>
<summary><b>3. App para Mac</b></summary>

```bash
cd escritorio
npm install
npm start          # para probar
npm run dist       # crea el instalador .dmg en escritorio/dist/
```
La app no está firmada por Apple, así que la primera vez ábrela con **clic derecho → Abrir**.
En **☁ NUBE → ⚙ NUBE** pones endpoint, bucket y claves, que se guardan cifradas en el llavero del Mac.
</details>

<details>
<summary><b>4. App Android (APK)</b></summary>

```bash
cd movil
npm install
npm run android:setup                    # solo la primera vez: crea el proyecto Android y agrega permisos
cd android && ./gradlew assembleDebug    # APK en android/app/build/outputs/apk/debug/app-debug.apk
```
Pasa el APK al celular (por cable, Drive, WhatsApp…), instálalo, acepta el permiso de notificaciones y escribe endpoint, bucket y tu clave de **solo lectura**.

Para actualizar después de hacer cambios:
```bash
npm run build && npx cap sync android && cd android && ./gradlew assembleDebug
```
Si la música se corta con la pantalla apagada: *Ajustes → Apps → Pixel Deck → Batería → Sin restricciones*.
</details>

---

## 🔒 Seguridad

- **No hay claves en el código.** Cada persona escribe las suyas en la app.
- Usa siempre una clave de **solo lectura** en el celular.
- Si una clave se filtra, bórrala en Cloudflare (*Manage API Tokens*) y crea otra.

## 🛠️ Hecho con

Electron · Capacitor 8 · React · Vite · Web Audio API · AWS SDK (S3) · Cloudflare R2 · rclone

Desarrollado paso a paso junto a **Claude** (Anthropic).

## 📄 Licencia

MIT © SolidPixel. Úsalo, modifícalo y compártelo.
