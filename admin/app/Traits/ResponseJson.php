<?php

namespace App\Traits;

use DateTimeInterface;
use Illuminate\Contracts\Support\Arrayable;
use Illuminate\Http\JsonResponse;
use JsonSerializable;
use stdClass;

trait ResponseJson
{
    protected function success(mixed $data = [], string $msg = 'ok', int $code = 200): JsonResponse
    {
        return response()->json([
            'code' => $code,
            'msg' => $msg,
            'data' => $this->normalizeResponseData($data),
            'timestamp' => time(),
        ]);
    }

    protected function error(string $msg = 'fail', int $code = 400, mixed $data = []): JsonResponse
    {
        return response()->json([
            'code' => $code,
            'msg' => $msg,
            'data' => $this->normalizeResponseData($data),
            'timestamp' => time(),
        ], $this->httpStatusFor($code));
    }

    protected function successPage(mixed $pageResult, string $msg = 'ok', int $code = 200): JsonResponse
    {
        $total = (int) $pageResult->total();
        $perPage = max(1, (int) $pageResult->perPage());
        $totalPage = $total === 0 ? 0 : (int) ceil($total / $perPage);
        $page = $total === 0 ? 0 : (int) $pageResult->currentPage();

        return response()->json([
            'code' => $code,
            'msg' => $msg,
            'data' => [
                'list' => $this->normalizeResponseData($pageResult->items()),
                'total' => $total,
                'page' => $page,
                'page_size' => $perPage,
                'total_page' => $totalPage,
            ],
            'timestamp' => time(),
        ]);
    }

    private function httpStatusFor(int $code): int
    {
        if ($code >= 100 && $code < 600) {
            return $code;
        }

        return match ((int) ($code / 1000)) {
            1 => 500,
            2 => 401,
            3 => 400,
            4 => 400,
            default => 400,
        };
    }

    private function normalizeResponseData(mixed $data): mixed
    {
        if ($data instanceof DateTimeInterface) {
            return $data->format('Y-m-d H:i:s');
        }

        if ($data instanceof Arrayable) {
            return $this->normalizeResponseData($data->toArray());
        }

        if ($data instanceof JsonSerializable) {
            return $this->normalizeResponseData($data->jsonSerialize());
        }

        if (is_array($data)) {
            foreach ($data as $key => $value) {
                $data[$key] = $this->normalizeResponseData($value);
            }

            return $data;
        }

        if ($data instanceof stdClass) {
            $normalized = [];
            foreach (get_object_vars($data) as $key => $value) {
                $normalized[$key] = $this->normalizeResponseData($value);
            }

            return (object) $normalized;
        }

        return $data;
    }
}
