#!/usr/bin/env bash
# Crea, o deja como están, los recursos de la actualización automática de datos. Se puede repetir sin riesgo.
#
#   infra/setup.sh            # todo lo que no necesita la clave de FIRMS y, si el secreto ya existe, lo demás
#
# Recursos (proyecto nasat-fire-calendar, us-east1):
#   bucket        gs://nasat-fire-calendar-data       la cola publicada (tail/) · privado
#   job           fire-tail                           procesa los días nuevos y publica la cola
#   scheduler     fire-tail-15min                     lo lanza cada 15 min; el job no hace nada si los feeds no cambiaron
#   secreto       firms-map-key                       la MAP_KEY de FIRMS (lo crea una persona del equipo)
#   cuentas       fire-tail-job · fire-tail-scheduler con el mínimo de permisos
set -euo pipefail

PROJECT="${PROJECT:-nasat-fire-calendar}"
REGION="${REGION:-us-east1}"
BUCKET="${BUCKET:-nasat-fire-calendar-data}"
JOB="${JOB:-fire-tail}"
SECRET="${SECRET:-firms-map-key}"
IMAGE="${IMAGE:-$REGION-docker.pkg.dev/$PROJECT/cloud-run-source-deploy/fire-tail:latest}"
RUNTIME_SA="${RUNTIME_SA:-538134722054-compute@developer.gserviceaccount.com}" # la que usa el servicio fire-calendar
JOB_SA="fire-tail-job@$PROJECT.iam.gserviceaccount.com"
SCHEDULER_SA="fire-tail-scheduler@$PROJECT.iam.gserviceaccount.com"
cd "$(dirname "$0")/.."

step() { printf '\n== %s\n' "$*"; }
g() { gcloud --project "$PROJECT" --quiet "$@"; }

step "APIs"
g services enable cloudscheduler.googleapis.com secretmanager.googleapis.com run.googleapis.com \
  cloudbuild.googleapis.com artifactregistry.googleapis.com storage.googleapis.com

step "Bucket (privado, solo acceso uniforme por IAM)"
g storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 ||
  g storage buckets create "gs://$BUCKET" --location "$REGION" --uniform-bucket-level-access --public-access-prevention

step "Cuentas de servicio"
for account in fire-tail-job:"Job de la cola de datos nuevos (FIRMS)" fire-tail-scheduler:"Scheduler que lanza el job de la cola"; do
  g iam service-accounts describe "${account%%:*}@$PROJECT.iam.gserviceaccount.com" >/dev/null 2>&1 ||
    g iam service-accounts create "${account%%:*}" --display-name "${account#*:}"
done

step "Permisos sobre el bucket"
g storage buckets add-iam-policy-binding "gs://$BUCKET" --member "serviceAccount:$JOB_SA" --role roles/storage.objectAdmin >/dev/null
g storage buckets add-iam-policy-binding "gs://$BUCKET" --member "serviceAccount:$RUNTIME_SA" --role roles/storage.objectViewer >/dev/null
echo "el job escribe y borra versiones viejas; el servicio solo lee"

step "Imagen del job (SKIP_BUILD=1 la omite si no cambió el código)"
if [ "${SKIP_BUILD:-}" != 1 ]; then
  g builds submit --config jobs/tail/cloudbuild.yaml --substitutions "_IMAGE=$IMAGE" .
fi

step "Secreto $SECRET"
if ! g secrets describe "$SECRET" >/dev/null 2>&1; then
  cat <<HINT
Falta el secreto con la MAP_KEY de FIRMS. Cópiala de tu correo (solo el valor de 32 caracteres) y ejecuta:

  k=\$(pbpaste | tr -d '[:space:]'); [[ \$k =~ ^[0-9a-f]{32}\$ ]] && printf %s "\$k" | gcloud secrets create $SECRET --project $PROJECT --replication-policy automatic --data-file=- || echo 'el portapapeles no es una MAP_KEY'

(solo crea el secreto si lo copiado tiene forma de MAP_KEY, y no imprime la clave) y vuelve a correr infra/setup.sh.
HINT
  exit 3
fi
# La última versión activa debe tener forma de MAP_KEY: si no, el job la rechazaría.
if ! g secrets versions access latest --secret "$SECRET" 2>/dev/null | tr -d '[:space:]' | grep -Eq '^[0-9a-f]{32}$'; then
  echo "La última versión activa de $SECRET no tiene forma de MAP_KEY (32 caracteres hexadecimales)."
  echo "Agrega una buena (mismo comando, con 'gcloud secrets versions add $SECRET') y destruye la mala."
  exit 4
fi
g secrets add-iam-policy-binding "$SECRET" --member "serviceAccount:$JOB_SA" --role roles/secretmanager.secretAccessor >/dev/null

step "Job $JOB"
g run jobs deploy "$JOB" --region "$REGION" --image "$IMAGE" --service-account "$JOB_SA" \
  --set-secrets "FIRMS_MAP_KEY=$SECRET:latest" --set-env-vars "FIRE_TAIL_STORE=gs://$BUCKET/tail" \
  --memory 2Gi --cpu 1 --task-timeout 600 --max-retries 1 --tasks 1 --parallelism 1
g run jobs add-iam-policy-binding "$JOB" --region "$REGION" --member "serviceAccount:$SCHEDULER_SA" --role roles/run.invoker >/dev/null

step "Scheduler cada 15 min"
URI="https://run.googleapis.com/v2/projects/$PROJECT/locations/$REGION/jobs/$JOB:run"
COMMON=(--location "$REGION" --schedule "*/15 * * * *" --time-zone UTC --uri "$URI" --http-method POST
  --oauth-service-account-email "$SCHEDULER_SA" --oauth-token-scope https://www.googleapis.com/auth/cloud-platform
  --attempt-deadline 60s)
if g scheduler jobs describe fire-tail-15min --location "$REGION" >/dev/null 2>&1; then
  g scheduler jobs update http fire-tail-15min "${COMMON[@]}"
else
  g scheduler jobs create http fire-tail-15min "${COMMON[@]}"
fi
echo
echo "Listo. Para probar ya: gcloud run jobs execute $JOB --region $REGION --project $PROJECT --wait"
