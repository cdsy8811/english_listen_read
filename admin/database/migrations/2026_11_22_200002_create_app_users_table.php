<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('app_users', function (Blueprint $table) {
            $table->id();
            $table->string('uuid', 64)->unique();
            $table->string('username', 64)->unique();
            $table->string('nickname', 64)->default('');
            $table->string('password');
            $table->tinyInteger('status')->default(1)->comment('0 禁用 1 正常');
            $table->timestamp('last_login_at')->nullable();
            $table->string('last_login_ip', 45)->nullable();
            $table->unsignedBigInteger('next_sync_seq')->default(1);
            $table->timestamps();
            $table->softDeletes();
        });

        Schema::create('app_devices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('app_user_id')->constrained('app_users')->cascadeOnDelete();
            $table->string('device_id', 128);
            $table->string('name', 128)->default('');
            $table->string('platform', 32)->default('');
            $table->string('app_version', 32)->default('');
            $table->timestamp('last_seen_at')->nullable();
            $table->string('last_ip', 45)->nullable();
            $table->timestamps();
            $table->unique(['app_user_id', 'device_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('app_devices');
        Schema::dropIfExists('app_users');
    }
};
