<?php

declare(strict_types=1);

namespace App\Bot;

final class EngineRegistry
{
    /** @var array<int, object> */
    public static array $blaze = [];
    /** @var array<int, object> */
    public static array $jonbet = [];
    /** @var array<int, \App\Bot\Blaze\BlazeAPI> */
    public static array $blazeApis = [];
    /** @var array<int, object> */
    public static array $jonbetApis = [];
    /** @var array<int, object> */
    public static array $daytrade = [];
}
