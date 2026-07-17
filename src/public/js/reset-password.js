const form =
document.getElementById("resetForm");


const message =
document.getElementById("message");



const urlParams =
new URLSearchParams(
    window.location.search
);



const token =
urlParams.get("token");




form.addEventListener(
"submit",
async (e)=>{


    e.preventDefault();



    const password =
    document.getElementById("password").value;



    const confirmPassword =
    document.getElementById("confirmPassword").value;



    if(password !== confirmPassword){

        message.style.color="#EF4444";

        message.textContent =
        "Passwords do not match";

        return;

    }



    try{


        const response =
        await fetch(
            "/api/v1/auth/reset-password",
            {
                method:"POST",

                headers:{
                    "Content-Type":"application/json"
                },

                body:JSON.stringify({

                    token,

                    password

                })

            }
        );



        const data =
        await response.json();



        if(!response.ok){

            throw new Error(
                data.message
            );

        }


        window.location.href = "/auth/reset-success";



    }
    catch(error){


        message.style.color="#EF4444";

        message.textContent =
        error.message;


    }



});
