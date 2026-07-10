<?php
// premium.php serve Blaze ou Jonbet conforme $platform do PageController
$portalPage = (($platform ?? 'BLAZE') === 'JONBET') ? 'premium-jonbet' : 'premium';
require view_path('user/_portal.php');
