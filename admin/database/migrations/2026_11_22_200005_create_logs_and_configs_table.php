<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('operation_logs', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id')->nullable()->index();
            $table->string('method', 8);
            $table->string('path', 255);
            $table->integer('status')->default(200);
            $table->integer('duration_ms')->default(0);
            $table->string('ip', 45)->default('');
            $table->string('user_agent', 500)->default('');
            $table->timestamp('created_at')->nullable()->index();
        });

        Schema::create('login_logs', function (Blueprint $table) {
            $table->id();
            $table->string('user_type', 16)->default('admin');
            $table->unsignedBigInteger('user_id')->nullable()->index();
            $table->string('username', 64);
            $table->tinyInteger('success')->default(0);
            $table->string('message', 255)->default('');
            $table->string('ip', 45)->default('');
            $table->string('user_agent', 500)->default('');
            $table->timestamp('created_at')->nullable()->index();
        });

        Schema::create('system_configs', function (Blueprint $table) {
            $table->id();
            $table->string('key', 128)->unique();
            $table->longText('value')->nullable();
            $table->string('group', 64)->default('basic');
            $table->string('remark', 255)->default('');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('system_configs');
        Schema::dropIfExists('login_logs');
        Schema::dropIfExists('operation_logs');
    }
};
