# Activación Web Push

La aplicación registra el dispositivo en Supabase y la Edge Function send-push está desplegada. Para enviar mensajes reales todavía debes configurar los secretos del servidor y un programador.

1. En Supabase > Edge Functions > Secrets, añade VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY y PUSH_SCHEDULER_TOKEN. El par VAPID debe coincidir con la clave pública de src/infrastructure/pushSupport.ts. Nunca publiques la privada.
2. En Database > Extensions habilita pg_cron y pg_net (si están disponibles). En Vault almacena un JWT de servidor autorizado y el mismo token del programador.
3. Programa una ejecución POST cada minuto a https://bwoqjsuohquqkpgssxcd.supabase.co/functions/v1/send-push usando Authorization Bearer con el JWT de Vault y x-orbit-scheduler-token con el token de Vault. No pegues secretos literales en el job.
4. Abre Orbit Tasks desde el icono instalado en iOS, entra a Avisos y pulsa Activar notificaciones. Autoriza el permiso.
5. Prueba un evento a unos minutos de distancia y revisa los registros device_subscriptions, push_delivery_log y los logs de send-push.

No hay envío automático hasta configurar correctamente estos pasos. La recepción a un segundo exacto no está garantizada por los sistemas operativos.
