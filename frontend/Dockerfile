# Higía — frontend (Next.js) en modo desarrollo.
#
# Modo dev a propósito, igual que el backend: esto corre solo en localhost, para
# un usuario, y lo que importa es que un cambio se vea al guardar.
FROM node:22-alpine

WORKDIR /app

# Las dependencias se instalan ANTES de copiar el código: así cambiar un .tsx no
# invalida la capa de npm y el rebuild es de segundos.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 3000
CMD ["npm", "run", "dev"]
