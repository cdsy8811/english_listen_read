<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>{{ config('app.name', '橙子英语') }} · 管理后台</title>
    @vite(['resources/css/app.css', 'resources/js/admin/app.js'])
</head>
<body>
    <div id="app"></div>
</body>
</html>
