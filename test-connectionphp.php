<?php
$servername = "192.168.1.135:22";
$username = "docu1";
$password = "Ioana2503.";
$database = "DocBase";

// Create connection
$conn = new mysqli($servername, $username, $password, $database);

// Check connection
if ($conn->connect_error) {
    http_response_code(500); // Internal Server Error
} else {
    http_response_code(200); // OK
}

$conn->close();
?>
