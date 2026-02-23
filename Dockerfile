# Usa una imagen oficial de Node.js
FROM node:20-alpine AS builder

# Establece directorio de trabajo
WORKDIR /app

# Copia los archivos de configuración primero para aprovechar la cache
COPY package*.json ./
COPY pnpm-lock.yaml* ./

# Instala dependencias
RUN npm install -g pnpm && pnpm install

# Copia el resto del código
COPY . .

# Compila el proyecto
RUN pnpm build

# ---------------------------
# Imagen final
FROM node:20-alpine

WORKDIR /app

# Copia solo lo necesario desde la etapa de build
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Instala solo dependencias de producción
RUN npm install --omit=dev

# Expone el puerto (ajústalo si tu app usa otro)
EXPOSE 3000

# Comando de inicio
CMD ["node", "dist/index.js", "--run"]
