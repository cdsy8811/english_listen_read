<?php

return [
    'max_push' => (int) env('APP_SYNC_MAX_PUSH', 500),
    'max_pull' => (int) env('APP_SYNC_MAX_PULL', 500),
    'tombstone_days' => (int) env('APP_SYNC_TOMBSTONE_DAYS', 180),
    'protocol_version' => 1,
];
