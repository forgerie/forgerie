# syntax=docker/dockerfile:1.7

ARG OPENSUSE_IMAGE=opensuse/tumbleweed
ARG DOCKER_CLI_VERSION=29-cli

FROM docker:${DOCKER_CLI_VERSION} AS docker-cli

FROM ${OPENSUSE_IMAGE} AS base

ARG NODEJS_MAJOR=22
ARG NODEJS_REPO=auto
ARG PI_WEB_EXTRA_ZYPPER_PACKAGES=""
ARG PI_WEB_UID=1000
ARG PI_WEB_GID=1000

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
  SHELL=/bin/bash \
  TERM=xterm-256color

COPY internal/image/install-opensuse-base /usr/local/sbin/install-forgerie-opensuse-base
RUN chmod 0755 /usr/local/sbin/install-forgerie-opensuse-base \
  && install-forgerie-opensuse-base

FROM base AS package

ARG FORGERIE_PACKAGE_SPEC
ARG CACHE_BUST=local

RUN set -eux; \
  echo "Forgerie Docker build cache bust: ${CACHE_BUST}"; \
  test -n "${FORGERIE_PACKAGE_SPEC}" || { echo "FORGERIE_PACKAGE_SPEC is required while Forgerie remains local-only" >&2; exit 1; }; \
  npm install -g --omit=dev --include=peer --no-audit --no-fund "${FORGERIE_PACKAGE_SPEC}" --allow-scripts=node-pty; \
  global_root="$(npm root -g)"; \
  global_prefix="$(npm prefix -g)"; \
  peer_pi_bin="${global_root}/forgerie/node_modules/.bin/pi"; \
  global_pi_bin="${global_prefix}/bin/pi"; \
  if [ -x "${peer_pi_bin}" ]; then \
    ln -sf "${peer_pi_bin}" "${global_pi_bin}"; \
  elif [ ! -x "${global_pi_bin}" ]; then \
    echo "Could not find pi binary from @earendil-works/pi-coding-agent" >&2; \
    exit 1; \
  fi; \
  npm cache clean --force

FROM base AS runtime

ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
  HOME=/data/home \
  XDG_CONFIG_HOME=/data/config \
  PI_WEB_HOST=0.0.0.0 \
  PI_WEB_PORT=8504 \
  PI_WEB_DATA_DIR=/data/forgerie \
  PI_WEB_SESSIOND_SOCKET=/data/forgerie/sessiond.sock \
  PI_CODING_AGENT_DIR=/data/pi-agent \
  HOSTEXEC_IMAGE=alpine:3.22 \
  SHELL=/bin/bash \
  TERM=xterm-256color

COPY --from=package /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=package /usr/local/bin /usr/local/bin
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins
COPY internal/bin/hostexec /usr/local/bin/hostexec
COPY forgerie-docker /usr/local/bin/forgerie-docker
RUN chmod 0755 /usr/local/bin/hostexec /usr/local/bin/forgerie-docker

COPY custom-image.d/ /tmp/forgerie-custom-image.d/
RUN bash -euxo pipefail -c '\
  shopt -s nullglob; \
  for script in /tmp/forgerie-custom-image.d/*.sh; do \
    echo "Running Forgerie custom image hook: ${script}"; \
    bash "${script}"; \
  done; \
  rm -rf /tmp/forgerie-custom-image.d; \
  zypper clean --all; \
  rm -rf /var/cache/zypp/* \
'

WORKDIR /workspace
USER forgerie

EXPOSE 8504

ENTRYPOINT ["tini", "--"]
CMD ["forgerie-server"]
