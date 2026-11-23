<?php

namespace App\Http\Controllers;

use App\Traits\ResponseJson;
use BadMethodCallException;
use Illuminate\Http\JsonResponse;

abstract class Controller
{
    use ResponseJson;

    public function __call($method, $parameters)
    {
        if ($method === 'show') {
            return $this->handleDefaultShow($parameters[0] ?? null);
        }

        throw new BadMethodCallException(sprintf(
            'Method %s::%s does not exist.',
            static::class,
            $method
        ));
    }

    protected function handleDefaultShow(mixed $id): JsonResponse
    {
        if (! method_exists($this, 'index')) {
            return $this->error('Resource not found.', 404);
        }

        $request = request();
        $detailRequest = $request->duplicate(
            array_merge($request->query(), [
                'id' => $id,
                'page' => 1,
                'page_size' => 1,
            ]),
            $request->request->all()
        );

        $response = app()->call([$this, 'index'], ['request' => $detailRequest]);
        $record = $this->extractShowRecord($response, $id);

        if (! $record) {
            return $this->error('Resource not found.', 404);
        }

        return $this->success($record);
    }

    protected function extractShowRecord(mixed $response, mixed $id): ?array
    {
        if (! ($response instanceof JsonResponse)) {
            return null;
        }

        $payload = $response->getData(true);
        $data = $payload['data'] ?? null;

        if (is_array($data) && array_is_list($data)) {
            foreach ($data as $item) {
                if (is_array($item) && (string) ($item['id'] ?? '') === (string) $id) {
                    return $item;
                }
            }

            return null;
        }

        if (is_array($data) && isset($data['list']) && is_array($data['list'])) {
            foreach ($data['list'] as $item) {
                if (is_array($item) && (string) ($item['id'] ?? '') === (string) $id) {
                    return $item;
                }
            }
        }

        if (is_array($data) && (string) ($data['id'] ?? '') === (string) $id) {
            return $data;
        }

        return null;
    }
}
