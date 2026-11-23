<?php

namespace App\Services\Ai;

class XfyunSigner
{
    public function rfc1123Gmt(?int $timestamp = null): string
    {
        return gmdate('D, d M Y H:i:s', $timestamp ?? time()).' GMT';
    }

    public function buildAuthQuery(string $path, string $method, string $signHost, string $apiKey, string $apiSecret, ?string $date = null): string
    {
        $date ??= $this->rfc1123Gmt();
        $origin = "host: {$signHost}\ndate: {$date}\n{$method} {$path} HTTP/1.1";
        $signature = base64_encode(hash_hmac('sha256', $origin, $apiSecret, true));
        $authOrigin = 'api_key="'.$apiKey.'", algorithm="hmac-sha256", '
            .'headers="host date request-line", signature="'.$signature.'"';
        $authorization = base64_encode($authOrigin);

        return http_build_query([
            'host' => $signHost,
            'date' => $date,
            'authorization' => $authorization,
        ], '', '&', PHP_QUERY_RFC1738);
    }

    /**
     * @return array{scheme: string, host: string, path: string}
     */
    public function split(string $url): array
    {
        $parts = parse_url($url);
        if (! $parts || empty($parts['host']) || empty($parts['path'])) {
            throw new \InvalidArgumentException('讯飞端点地址格式不正确');
        }

        return [
            'scheme' => $parts['scheme'] ?? 'https',
            'host' => $parts['host'],
            'path' => $parts['path'],
        ];
    }

    public function signedUrl(string $url, string $method, ?string $signHost = null): string
    {
        $parts = $this->split($url);
        $host = $signHost ?: $parts['host'];
        $query = $this->buildAuthQuery(
            $parts['path'],
            strtoupper($method),
            $host,
            (string) config('xfyun.api_key'),
            (string) config('xfyun.api_secret')
        );

        return $parts['scheme'].'://'.$parts['host'].$parts['path'].'?'.$query;
    }
}
