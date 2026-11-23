<?php

namespace App\Services;

abstract class BaseService
{
    /**
     * 通用列表查询。
     * 参数格式：field=value|operator，operator 支持 =, !=, >, <, >=, <=, like, in, between。
     * 字段名做白名单格式校验，避免拼接 SQL。
     */
    protected function handleSearch($query, array $params)
    {
        foreach ($params as $key => $value) {
            if ($value === '' || $value === null) {
                continue;
            }

            if (in_array($key, [
                'page', 'page_size', 'pageSize', 'per_page', 'perPage',
                'sort_by', 'sort_order', 'keyword', 'id',
            ], true)) {
                continue;
            }

            $field = (string) $key;
            $operator = '=';
            $isArrayValue = is_array($value);

            if (! preg_match('/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/', $field)) {
                continue;
            }

            if (! $isArrayValue && is_string($value) && str_contains($value, '|')) {
                [$val, $op] = explode('|', $value, 2);
                $value = $val;
                $operator = strtolower(trim((string) $op));
            }

            switch ($operator) {
                case 'like':
                    $query->where($field, 'like', '%'.$value.'%');
                    break;
                case 'in':
                    $values = $isArrayValue ? $value : explode(',', (string) $value);
                    $query->whereIn($field, array_values(array_filter($values, fn ($v) => $v !== '')));
                    break;
                case 'between':
                    $dates = $isArrayValue ? array_values($value) : array_map('trim', explode(',', (string) $value));
                    if (count($dates) === 2 && $dates[0] !== '' && $dates[1] !== '') {
                        $query->whereBetween($field, [$dates[0], $dates[1]]);
                    }
                    break;
                case '!=':
                case '>':
                case '<':
                case '>=':
                case '<=':
                    $query->where($field, $operator, $value);
                    break;
                default:
                    if ($isArrayValue) {
                        $query->whereIn($field, $value);
                    } else {
                        $query->where($field, $value);
                    }
                    break;
            }
        }

        if (isset($params['sort_by'], $params['sort_order'])) {
            $sortBy = (string) $params['sort_by'];
            $sortOrder = strtolower((string) $params['sort_order']) === 'asc' ? 'asc' : 'desc';
            if (preg_match('/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/', $sortBy)) {
                $query->orderBy($sortBy, $sortOrder);
            }
        } elseif (! str_contains($query->toSql(), 'order by')) {
            $query->orderByDesc($query->getModel()->getQualifiedKeyName());
        }

        return $query;
    }

    protected function perPage($request, int $default = 20, int $max = 200): int
    {
        $value = (int) ($request->input('page_size') ?: $request->input('pageSize') ?: $default);

        return max(1, min($max, $value));
    }

    protected function paginateQuery($query, $request, ?callable $transform = null)
    {
        $page = max(1, (int) ($request->input('page') ?: 1));
        $paginator = $query->paginate($this->perPage($request), ['*'], 'page', $page);

        if ($transform) {
            $paginator->setCollection(
                $paginator->getCollection()->map($transform)
            );
        }

        return $paginator;
    }
}
