<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_call_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('app_user_id')->nullable()->constrained('app_users')->nullOnDelete();
            $table->string('capability', 32);
            $table->string('provider', 32)->default('xfyun');
            $table->string('model', 64)->default('');
            $table->string('request_id', 64)->default('');
            $table->unsignedInteger('input_units')->default(0);
            $table->unsignedInteger('output_units')->default(0);
            $table->unsignedInteger('latency_ms')->default(0);
            $table->string('status', 16)->default('ok');
            $table->string('error_code', 64)->default('');
            $table->text('error_message')->nullable();
            $table->string('ip', 45)->default('');
            $table->timestamp('created_at')->nullable()->index();
            $table->index(['app_user_id', 'created_at']);
            $table->index(['capability', 'created_at']);
        });

        Schema::create('tts_assets', function (Blueprint $table) {
            $table->id();
            $table->string('hash', 64)->unique();
            $table->string('lang', 8);
            $table->string('vcn', 64);
            $table->integer('speed');
            $table->string('path', 500);
            $table->unsignedBigInteger('bytes')->default(0);
            $table->unsignedBigInteger('hits')->default(0);
            $table->timestamp('last_used_at')->nullable();
            $table->timestamps();
            $table->index('last_used_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tts_assets');
        Schema::dropIfExists('ai_call_logs');
    }
};
