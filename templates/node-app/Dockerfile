FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node package.json server.js ./
COPY --chown=node:node public ./public
COPY --chown=node:node sdk ./sdk
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3101
USER node
EXPOSE 3101
CMD ["node", "server.js"]
