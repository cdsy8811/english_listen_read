<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('units', function (Blueprint $table) {
            $table->id();
            $table->foreignId('app_user_id')->constrained('app_users')->cascadeOnDelete();
            $table->string('uuid', 64);
            $table->string('title', 255);
            $table->string('source_img', 500)->default('');
            $table->unsignedBigInteger('created_at_ms')->default(0);
            $table->unsignedBigInteger('client_updated_at_ms')->default(0);
            $table->unsignedBigInteger('sync_seq')->default(0);
            $table->timestamps();
            $table->softDeletes();
            $table->unique(['app_user_id', 'uuid']);
            $table->index(['app_user_id', 'sync_seq']);
            $table->index(['app_user_id', 'created_at_ms']);
        });

        Schema::create('words', function (Blueprint $table) {
            $table->id();
            $table->foreignId('app_user_id')->constrained('app_users')->cascadeOnDelete();
            $table->string('uuid', 64);
            $table->string('unit_uuid', 64);
            $table->string('word', 128);
            $table->string('phonetic_uk', 128)->default('');
            $table->string('phonetic_us', 128)->default('');
            $table->string('pos', 64)->default('');
            $table->text('translation')->nullable();
            $table->text('example')->nullable();
            $table->string('audio_path', 500)->default('');
            $table->integer('sort')->default(0);
            $table->tinyInteger('wrong')->default(0);
            $table->integer('wrong_count')->default(0);
            $table->unsignedBigInteger('client_updated_at_ms')->default(0);
            $table->unsignedBigInteger('sync_seq')->default(0);
            $table->timestamps();
            $table->softDeletes();
            $table->unique(['app_user_id', 'uuid']);
            $table->index(['app_user_id', 'unit_uuid']);
            $table->index(['app_user_id', 'sync_seq']);
            $table->index(['app_user_id', 'word']);
        });

        Schema::create('practice_records', function (Blueprint $table) {
            $table->id();
            $table->foreignId('app_user_id')->constrained('app_users')->cascadeOnDelete();
            $table->string('uuid', 64);
            $table->string('word_uuid', 64);
            $table->string('mode', 8);
            $table->string('input_type', 16)->default('');
            $table->text('raw_text')->nullable();
            $table->text('asr_text')->nullable();
            $table->integer('score')->default(0);
            $table->longText('detail_json')->nullable();
            $table->unsignedBigInteger('created_at_ms')->default(0);
            $table->unsignedBigInteger('client_updated_at_ms')->default(0);
            $table->unsignedBigInteger('sync_seq')->default(0);
            $table->timestamps();
            $table->softDeletes();
            $table->unique(['app_user_id', 'uuid']);
            $table->index(['app_user_id', 'sync_seq']);
            $table->index(['app_user_id', 'word_uuid']);
            $table->index(['app_user_id', 'created_at_ms']);
        });

        Schema::create('read_articles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('app_user_id')->constrained('app_users')->cascadeOnDelete();
            $table->string('uuid', 64);
            $table->string('title', 255);
            $table->string('source_img', 500)->default('');
            $table->longText('content');
            $table->longText('translations')->nullable();
            $table->unsignedBigInteger('created_at_ms')->default(0);
            $table->unsignedBigInteger('client_updated_at_ms')->default(0);
            $table->unsignedBigInteger('sync_seq')->default(0);
            $table->timestamps();
            $table->softDeletes();
            $table->unique(['app_user_id', 'uuid']);
            $table->index(['app_user_id', 'sync_seq']);
            $table->index(['app_user_id', 'created_at_ms']);
        });

        Schema::create('read_records', function (Blueprint $table) {
            $table->id();
            $table->foreignId('app_user_id')->constrained('app_users')->cascadeOnDelete();
            $table->string('uuid', 64);
            $table->string('article_uuid', 64);
            $table->integer('sentence_index')->default(0);
            $table->text('asr_text')->nullable();
            $table->integer('score')->default(0);
            $table->longText('detail_json')->nullable();
            $table->unsignedBigInteger('created_at_ms')->default(0);
            $table->unsignedBigInteger('client_updated_at_ms')->default(0);
            $table->unsignedBigInteger('sync_seq')->default(0);
            $table->timestamps();
            $table->softDeletes();
            $table->unique(['app_user_id', 'uuid']);
            $table->index(['app_user_id', 'sync_seq']);
            $table->index(['app_user_id', 'article_uuid']);
            $table->index(['app_user_id', 'created_at_ms']);
        });

        Schema::create('study_sessions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('app_user_id')->constrained('app_users')->cascadeOnDelete();
            $table->string('uuid', 64);
            $table->string('kind', 16);
            $table->string('mode', 16)->default('');
            $table->string('unit_uuid', 64)->default('');
            $table->string('title', 255)->default('');
            $table->unsignedBigInteger('started_at_ms')->default(0);
            $table->unsignedBigInteger('ended_at_ms')->default(0);
            $table->integer('duration_sec')->default(0);
            $table->integer('total')->default(0);
            $table->integer('answered')->default(0);
            $table->integer('passed')->default(0);
            $table->integer('avg_score')->default(0);
            $table->unsignedBigInteger('created_at_ms')->default(0);
            $table->unsignedBigInteger('client_updated_at_ms')->default(0);
            $table->unsignedBigInteger('sync_seq')->default(0);
            $table->timestamps();
            $table->softDeletes();
            $table->unique(['app_user_id', 'uuid']);
            $table->index(['app_user_id', 'sync_seq']);
            $table->index(['app_user_id', 'created_at_ms']);
        });

        Schema::create('app_settings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('app_user_id')->unique()->constrained('app_users')->cascadeOnDelete();
            $table->longText('payload')->nullable();
            $table->unsignedBigInteger('client_updated_at_ms')->default(0);
            $table->unsignedBigInteger('sync_seq')->default(0);
            $table->timestamps();
            $table->softDeletes();
            $table->index(['app_user_id', 'sync_seq']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('app_settings');
        Schema::dropIfExists('study_sessions');
        Schema::dropIfExists('read_records');
        Schema::dropIfExists('read_articles');
        Schema::dropIfExists('practice_records');
        Schema::dropIfExists('words');
        Schema::dropIfExists('units');
    }
};
