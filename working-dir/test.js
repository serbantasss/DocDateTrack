// // Set up the picker
// const client = filestack.init(yourAPIKey);
// const options = {
//     onUploadDone: updateForm,
//     maxSize: 10 * 1024 * 1024,
//     accept: 'image/*',
//     uploadInBackground: false,
// };
// const picker = client.picker(options);
//
// // Get references to the DOM elements
//
// const form = document.getElementById('pick-form');
// const fileInput = document.getElementById('fileupload');
// const btn = document.getElementById('picker');
// const nameBox = document.getElementById('nameBox');
// const urlBox = document.getElementById('urlBox');
//
// // Add our event listeners
//
// btn.addEventListener('click', function (e) {
//     e.preventDefault();
//     picker.open();
// });
//
// form.addEventListener('submit', function (e) {
//     e.preventDefault();
//     alert('Submitting: ' + fileInput.value);
// });
//
// // Helper to overwrite the field input value
//
// function updateForm (result) {
//     const fileData = result.filesUploaded[0];
//     fileInput.value = fileData.url;
//
//     // Some ugly DOM code to show some data.
//     const name = document.createTextNode('Selected: ' + fileData.filename);
//     const url = document.createElement('a');
//     url.href = fileData.url;
//     url.appendChild(document.createTextNode(fileData.url));
//     nameBox.appendChild(name);
//     urlBox.appendChild(document.createTextNode('Uploaded to: '));
//     urlBox.appendChild(url);
// };
//





$(document).ready(function() {

// Add active class to inputs
    $("#prospects_form .boxsize").focus(function() { $(this).addClass("hasText"); });
    $("#form_validation .boxsize").focus(function() { $(this).parent().addClass("hasText"); });
// Remove active class from inputs (if empty)
    $("#prospects_form .boxsize").blur(function() { if ( this.value === "") { $(this).removeClass("hasText"); } });
    $("#form_validation .boxsize").blur(function() { if ( this.value === "") { $(this).parent().removeClass("hasText"); } });



///////////////////
// START VALIDATION
    $("#prospects_form").ready(function() {

        // DEFINE GLOBAL VARIABLES
        var valName = $('#form_name'),
            valEmail = $("#form_email"),
            valEmailFormat = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
            valMsg = $('#form_message'),
            valCaptcha = $('#form_captcha'),
            valCaptchaCode = $('.form_captcha_code');



        // Generate captcha
        function randomgen() {
            var rannumber = "";
            // Iterate through 1 to 9, 4 times
            for(ranNum=1; ranNum<=4; ranNum++){ rannumber+=Math.floor(Math.random()*10).toString(); }
            // Apply captcha to element
            valCaptchaCode.html(rannumber);
        }
        randomgen();


        // CAPTCHA VALIDATION
        valCaptcha.blur(function() {
            function formCaptcha() {
                if ( valCaptcha.val() == valCaptchaCode.html() ) {
                    // Incorrect
                    valCaptcha.parent().addClass("invalid");
                    return false;
                } else {
                    // Correct
                    valCaptcha.parent().removeClass("invalid");
                    return true;
                }
            }
            formCaptcha();
        });

        // Remove invalid class from captcha if typing
        valCaptcha.keypress(function() {
            valCaptcha.parent().removeClass("invalid");
        });


        // EMAIL VALIDATION (BLUR)
        valEmail.blur(function() {
            function formEmail() {
                if (!valEmailFormat.test(valEmail.val()) && valEmail.val() !== "" ) {
                    // Incorrect
                    valEmail.addClass("invalid");
                } else {
                    // Correct
                    valEmail.removeClass("invalid");
                }
            }
            formEmail();
        });

        // Remove invalid class from email if typing
        valEmail.keypress(function() {
            valEmail.removeClass("invalid");
        });


        // VALIDATION ON SUBMIT
        $('#prospects_form').submit(function() {
            console.log('user hit send button');

            // EMAIL VALIDATION (SUBMIT)
            function formEmailSubmit() {
                if (!valEmailFormat.test(valEmail.val())) {
                    // Incorrect
                    valEmail.addClass("invalid");
                } else {
                    // Correct
                    valEmail.removeClass("invalid");
                }
            }
            formEmailSubmit();

            // Validate captcha
            function formCaptchaSubmit() {
                if( valCaptcha.val() === valCaptchaCode.html() ) {
                    // Captcha is correct
                } else {
                    // Captcha is incorrect
                    valCaptcha.parent().addClass("invalid");
                    randomgen();
                }
            }
            formCaptchaSubmit();


            // If NAME field is empty
            function formNameSubmit() {
                if ( valName.val() === "" ) {
                    // Name is empty
                    valName.addClass("invalid");
                } else {
                    valName.removeClass("invalid");
                }
            }
            formNameSubmit();


            // If MESSAGE field is empty
            function formMessageSubmit() {
                if ( valMsg.val() === "" ) {
                    // Name is empty
                    valMsg.addClass("invalid");
                } else {
                    valMsg.removeClass("invalid");
                }
            }
            formMessageSubmit();


            // Submit form (if all good)
            function processForm() {
                if ( formEmailSubmit() && formCaptchaSubmit() && formNameSubmit() && formMessageSubmit() ) {
                    $("#prospects_form").attr("action", "/clients/oubc/row-for-oubc-send.php");
                    $("#form_send").attr("type", "submit");
                    return true;
                } else if( !formEmailSubmit() ) {
                    valEmail.addClass("invalid");
                    return false;
                } else if ( !formCaptchaSubmit() ) {
                    valCaptcha.parent().addClass("invalid");
                    return false;
                } else if ( !formNameSubmit() ) {
                    valName.addClass("invalid");
                    return false;
                } else if ( !formMessageSubmit() ) {
                    valMsg.addClass("invalid");
                    return false;
                } else {
                    return false;
                }
            }
        });
    });
    // END VALIDATION
    /////////////////
});
